/**
 * Golf EOD scoring helpers (roadmap 6.4d).
 * Mirrors `src/sg/score.py` / `src/sg/rounds.py` for hub create.
 */

import type {
  GolfScoreboardEvent,
  GolfScoreboardSnapshot,
  GolfScoreboardTeamWeek,
  Team,
} from "@/lib/data";
import type { GolfSettings } from "@/lib/golf";
import type { GolfLineupsFile } from "@/lib/golf-lineup";

type RoundRow = {
  player_id: number;
  round: number;
  to_par: number | null;
  status: string;
};

type RoundFile = {
  event_id: string;
  grain: string;
  rounds: RoundRow[];
};

const ROUND_LABELS: Record<number, string> = {
  1: "Thu",
  2: "Fri",
  3: "Sat",
  4: "Sun",
};
const MIDWEEK = new Set([1, 2]);
const WEEKEND = new Set([3, 4]);

export function toParPoints(toPar: number | null | undefined): number {
  if (toPar == null) return 0;
  return -Number(toPar);
}

function fixturePlayerRounds(
  playerId: number,
  missCut: boolean,
): RoundRow[] {
  const base = ((playerId * 17) % 9) - 4;
  const rows: RoundRow[] = [];
  for (const rnd of [1, 2, 3, 4]) {
    const drift = ((playerId + rnd * 3) % 5) - 2;
    const toPar = base + drift;
    if (missCut && rnd >= 3) {
      rows.push({
        player_id: playerId,
        round: rnd,
        to_par: null,
        status: "mc",
      });
    } else {
      rows.push({
        player_id: playerId,
        round: rnd,
        to_par: toPar,
        status: "active",
      });
    }
  }
  return rows;
}

export function fixtureEventRounds(
  eventId: string,
  playerIds: number[],
  missCutEvery = 7,
): RoundFile {
  const rounds: RoundRow[] = [];
  for (const pid of playerIds) {
    const miss = missCutEvery > 0 && pid % missCutEvery === 0;
    rounds.push(...fixturePlayerRounds(pid, miss));
  }
  return { event_id: eventId, grain: "end_of_day", rounds };
}

function indexRounds(
  roundFile: RoundFile,
): Map<number, Map<number, RoundRow>> {
  const out = new Map<number, Map<number, RoundRow>>();
  for (const row of roundFile.rounds) {
    let byRound = out.get(row.player_id);
    if (!byRound) {
      byRound = new Map();
      out.set(row.player_id, byRound);
    }
    byRound.set(row.round, row);
  }
  return out;
}

function statusOf(row: RoundRow | undefined): string {
  return row?.status ?? "dns";
}

function isOut(row: RoundRow | undefined): boolean {
  return ["mc", "wd", "dns"].includes(statusOf(row));
}

function slotPoints(row: RoundRow | undefined): number {
  if (!row || statusOf(row) !== "active") return 0;
  return toParPoints(row.to_par);
}

function eventMultiplier(golf: GolfSettings, tier: string | undefined): number {
  const key = (tier || "regular").toLowerCase() as keyof GolfSettings["multipliers"];
  return Number(golf.multipliers[key] ?? golf.multipliers.regular ?? 1);
}

export function scoreTeamWeek(
  lineup: {
    starters: number[];
    captain: number;
    alt1?: number | null;
    alt2?: number | null;
  },
  roundFile: RoundFile,
  golf: GolfSettings,
  multiplier: number,
): GolfScoreboardTeamWeek {
  const byPlayer = indexRounds(roundFile);
  const starters = lineup.starters.map(Number);
  const captain = Number(lineup.captain);
  const alt1 = lineup.alt1 == null ? null : Number(lineup.alt1);
  const alt2 = lineup.alt2 == null ? null : Number(lineup.alt2);
  const byRound: GolfScoreboardTeamWeek["by_round"] = {};
  let weekRaw = 0;
  let captainWeek = 0;

  for (const rnd of [1, 2, 3, 4]) {
    const mode = golf.missed_cut.mode;
    const weekend = WEEKEND.has(rnd);
    const altQueue: Array<{ source: string; id: number }> = [];
    if (weekend && (mode === "alt1" || mode === "alt1_2") && alt1 != null) {
      altQueue.push({ source: "alt1", id: alt1 });
    }
    if (weekend && mode === "alt1_2" && alt2 != null) {
      altQueue.push({ source: "alt2", id: alt2 });
    }

    const slots = starters.map((starterId) => {
      let row = byPlayer.get(starterId)?.get(rnd);
      let source = "starter";
      let playerId = starterId;
      if (weekend && mode !== "off" && isOut(row)) {
        let replaced = false;
        while (altQueue.length) {
          const next = altQueue.shift()!;
          const altRow = byPlayer.get(next.id)?.get(rnd);
          if (altRow && statusOf(altRow) === "active") {
            playerId = next.id;
            row = altRow;
            source = next.source;
            replaced = true;
            break;
          }
        }
        if (!replaced) row = undefined;
      }
      return {
        player_id: playerId,
        starter_id: starterId,
        source,
        status: row ? statusOf(row) : statusOf(byPlayer.get(starterId)?.get(rnd)),
        to_par: row?.to_par ?? null,
        points: slotPoints(row),
      };
    });

    let counted = slots;
    let dropped: typeof slots = [];
    let points = 0;
    if (MIDWEEK.has(rnd)) {
      const keepN = golf.scoring.thu_fri_count || 4;
      const ranked = slots
        .map((slot, index) => ({ slot, index }))
        .sort((a, b) => b.slot.points - a.slot.points || a.index - b.index);
      const keep = new Set(ranked.slice(0, keepN).map((r) => r.index));
      counted = slots.filter((_, i) => keep.has(i));
      dropped = slots.filter((_, i) => !keep.has(i));
      points = counted.reduce((sum, s) => sum + s.points, 0);
    } else {
      points = slots.reduce((sum, s) => sum + s.points, 0);
    }

    const countedIds = counted.map((s) => s.player_id);
    byRound[String(rnd)] = {
      round: rnd,
      label: ROUND_LABELS[rnd] ?? String(rnd),
      points,
      slots,
      counted_player_ids: countedIds,
      dropped_player_ids: dropped.map((s) => s.player_id),
    };
    weekRaw += points;
    if (countedIds.includes(captain)) {
      const capSlot = slots.find(
        (s) => s.player_id === captain && s.source === "starter",
      );
      if (capSlot) captainWeek += capSlot.points;
    }
  }

  return {
    starters,
    captain,
    alt1,
    alt2,
    week_raw: weekRaw,
    week_total: weekRaw * multiplier,
    captain_week: captainWeek,
    multiplier,
    by_round: byRound,
  };
}

export function compareH2h(
  home: GolfScoreboardTeamWeek,
  away: GolfScoreboardTeamWeek,
  captainTiebreaker = true,
): "W" | "L" | "T" {
  if (home.week_total > away.week_total) return "W";
  if (home.week_total < away.week_total) return "L";
  if (captainTiebreaker) {
    if (home.captain_week > away.captain_week) return "W";
    if (home.captain_week < away.captain_week) return "L";
  }
  return "T";
}

export function buildScoreboardPayload(
  teams: Team[],
  lineups: GolfLineupsFile,
  golf: GolfSettings,
  scoredAt: string,
): GolfScoreboardSnapshot {
  const fieldIds: number[] = [];
  const seen = new Set<number>();
  for (const event of lineups.events) {
    for (const key of Object.keys(event.tee_times ?? {})) {
      const id = Number(key);
      if (!Number.isNaN(id) && !seen.has(id)) {
        seen.add(id);
        fieldIds.push(id);
      }
    }
  }
  for (const team of teams) {
    for (const player of team.roster ?? []) {
      if (player.id == null) continue;
      const id = Number(player.id);
      if (!Number.isNaN(id) && !seen.has(id)) {
        seen.add(id);
        fieldIds.push(id);
      }
    }
  }

  const nameById = new Map(teams.map((t) => [t.team_id, t.name] as const));
  const events: GolfScoreboardEvent[] = lineups.events.map((event) => {
    const mult = eventMultiplier(golf, event.multiplier_tier);
    const rounds = fixtureEventRounds(event.event_id, fieldIds);
    const teamScores: Record<string, GolfScoreboardTeamWeek> = {};
    for (const [teamId, byEvent] of Object.entries(lineups.teams)) {
      const lineup = byEvent[event.event_id];
      if (!lineup) continue;
      teamScores[teamId] = scoreTeamWeek(lineup, rounds, golf, mult);
    }
    const ordered = Object.keys(teamScores)
      .map(Number)
      .sort((a, b) => a - b);
    const pairings: GolfScoreboardEvent["pairings"] = [];
    for (let i = 0; i < ordered.length - 1; i += 2) {
      const homeId = ordered[i]!;
      const awayId = ordered[i + 1]!;
      const home = teamScores[String(homeId)]!;
      const away = teamScores[String(awayId)]!;
      pairings.push({
        home_team_id: homeId,
        away_team_id: awayId,
        home_name: nameById.get(homeId) ?? null,
        away_name: nameById.get(awayId) ?? null,
        home_total: home.week_total,
        away_total: away.week_total,
        home_captain_week: home.captain_week,
        away_captain_week: away.captain_week,
        outcome: compareH2h(home, away, golf.captain_tiebreaker),
      });
    }
    return {
      event_id: event.event_id,
      name: event.name,
      week: event.week,
      multiplier_tier: event.multiplier_tier,
      multiplier: mult,
      scored_at: scoredAt,
      teams: teamScores,
      pairings,
    };
  });

  return {
    period_label: "event",
    current_event_id:
      lineups.current_event_id ?? events[0]?.event_id ?? null,
    events,
  };
}
