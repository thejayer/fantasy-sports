/**
 * Golfer detail aggregations from lineups + scoreboard (roadmap 8.3).
 * Offline / fixture-safe — no tour feed.
 */

import type { LeagueSnapshot, Player, Team } from "@/lib/data";
import { parseGolfSettings, DEFAULT_GOLF_SETTINGS } from "@/lib/golf";

export type GolferStartRow = {
  eventId: string;
  eventName: string;
  week: number | null;
  segmentId: string | null;
  slot: "starter" | "captain" | "alt1" | "alt2";
  teamId: number;
  teamName: string;
};

export type GolferRoundResult = {
  eventId: string;
  eventName: string;
  round: number;
  label: string;
  status: string;
  toPar: number | null;
  points: number;
  source: string;
};

export type GolferProfileBoard = {
  playerId: number | string;
  name: string;
  ownershipPct: number;
  ownerTeam: Team | null;
  starts: GolferStartRow[];
  startsUsedBySegment: Array<{
    segmentId: string;
    used: number;
    max: number | null;
  }>;
  results: GolferRoundResult[];
  weekPoints: number;
  disclaimer: string;
};

function playerIdKey(id: number | string | null | undefined): string | null {
  if (id == null || id === "") return null;
  return String(id);
}

/** League ownership % — unique draft rosters → 0 or 100 (or fractional if shared). */
export function leagueOwnershipPct(
  league: LeagueSnapshot,
  playerId: number | string,
): { pct: number; teams: Team[] } {
  const key = playerIdKey(playerId);
  if (!key) return { pct: 0, teams: [] };
  const teams = league.teams.filter((team) =>
    (team.roster ?? []).some((p) => playerIdKey(p.id) === key),
  );
  const n = Math.max(league.teams.length, 1);
  return { pct: (teams.length / n) * 100, teams };
}

export function buildGolferProfileBoard(
  league: LeagueSnapshot,
  player: Player,
  ownerTeam: Team | null,
): GolferProfileBoard {
  const golf = parseGolfSettings(league.settings) ?? DEFAULT_GOLF_SETTINGS;
  const key = playerIdKey(player.id);
  const { pct, teams } = leagueOwnershipPct(league, player.id ?? "");
  const starts: GolferStartRow[] = [];
  const results: GolferRoundResult[] = [];
  let weekPoints = 0;

  const events = league.lineups?.events ?? [];
  const eventName = (id: string) =>
    events.find((e) => e.event_id === id)?.name ?? id;

  for (const team of league.teams) {
    const byEvent = league.lineups?.teams?.[String(team.team_id)] ?? {};
    for (const event of events) {
      const lined = byEvent[event.event_id];
      if (!lined || key == null) continue;
      const starters = (lined.starters ?? []).map(String);
      let slot: GolferStartRow["slot"] | null = null;
      if (starters.includes(key)) {
        slot =
          String(lined.captain) === key ? "captain" : "starter";
      } else if (lined.alt1 != null && String(lined.alt1) === key) {
        slot = "alt1";
      } else if (lined.alt2 != null && String(lined.alt2) === key) {
        slot = "alt2";
      }
      if (!slot) continue;
      starts.push({
        eventId: event.event_id,
        eventName: event.name,
        week: event.week ?? null,
        segmentId: event.segment_id ?? null,
        slot,
        teamId: team.team_id,
        teamName: team.name,
      });
    }
  }

  for (const event of league.scoreboard?.events ?? []) {
    for (const [teamId, week] of Object.entries(event.teams ?? {})) {
      for (const round of Object.values(week.by_round ?? {})) {
        for (const slot of round.slots ?? []) {
          if (playerIdKey(slot.player_id) !== key) continue;
          results.push({
            eventId: event.event_id,
            eventName: event.name ?? eventName(event.event_id),
            round: round.round,
            label: round.label,
            status: slot.status,
            toPar: slot.to_par ?? null,
            points: slot.points,
            source: slot.source,
          });
          weekPoints += slot.points * (event.multiplier || 1);
        }
      }
      void teamId;
    }
  }
  results.sort(
    (a, b) =>
      a.eventId.localeCompare(b.eventId) ||
      a.round - b.round,
  );

  const maxStarts = golf.starts.max_per_segment;
  const bySegment = new Map<string, number>();
  for (const row of starts) {
    if (row.slot !== "starter" && row.slot !== "captain") continue;
    const seg = row.segmentId ?? "default";
    bySegment.set(seg, (bySegment.get(seg) ?? 0) + 1);
  }
  const startsUsedBySegment = [...bySegment.entries()].map(
    ([segmentId, used]) => ({
      segmentId,
      used,
      max: maxStarts && maxStarts > 0 ? maxStarts : null,
    }),
  );

  return {
    playerId: player.id ?? "",
    name: player.name ?? `Player ${player.id}`,
    ownershipPct: pct,
    ownerTeam: ownerTeam ?? teams[0] ?? null,
    starts,
    startsUsedBySegment,
    results,
    weekPoints,
    disclaimer:
      "Usage and results come from synced lineups + EOD scoreboard slots. Ownership is roster share across this league (fixture drafts are unique). Not a live tour feed.",
  };
}
