/**
 * Football week box-score helpers (roadmap 8.1).
 * Pure — display league-applied ``points``, never raw yardage as the score.
 */

import type {
  BoxScoreMatchup,
  BoxScorePlayer,
  LeagueSnapshot,
  WeekBoxScoreSnapshot,
} from "@/lib/data";
import { samePlayerId } from "@/lib/player-profile";

/** One week row on a football player game log (from ``weeks/{N}.json``). */
export type PlayerWeekLogRow = {
  week: number;
  teamId: number | null;
  opponentTeamId: number | null;
  slot: string | null;
  points: number | null;
  projectedPoints: number | null;
  proOpponent: string | null;
  onByeWeek: boolean;
  isPlayoff: boolean;
  name: string | null;
  position: string | null;
};

export type PlayerWeekGameLog = {
  rows: PlayerWeekLogRow[];
  /** Sum of non-null league points across weeks. */
  totalPoints: number | null;
  /** Mean of non-null league points. */
  avgPoints: number | null;
};

const STARTER_SLOTS = new Set([
  "QB",
  "RB",
  "WR",
  "TE",
  "FLEX",
  "OP",
  "RB/WR",
  "WR/TE",
  "RB/WR/TE",
  "SUPERFLEX",
  "K",
  "D/ST",
  "DST",
  "DEF",
]);

export function formatBoxPoints(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(1);
}

export function findBoxMatchup(
  snapshot: WeekBoxScoreSnapshot | null | undefined,
  teamA: number,
  teamB: number,
): BoxScoreMatchup | null {
  if (!snapshot?.matchups?.length) return null;
  for (const m of snapshot.matchups) {
    const home = m.home_team_id;
    const away = m.away_team_id;
    if (
      (home === teamA && away === teamB) ||
      (home === teamB && away === teamA)
    ) {
      return m;
    }
  }
  return null;
}

/** Parse ``box=1-2`` query (unordered team pair). */
export function parseBoxPair(
  raw: string | undefined | null,
): { a: number; b: number } | null {
  if (!raw) return null;
  const m = /^(\d+)-(\d+)$/.exec(raw.trim());
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return null;
  return { a, b };
}

export function boxPairKey(teamA: number, teamB: number): string {
  const lo = Math.min(teamA, teamB);
  const hi = Math.max(teamA, teamB);
  return `${lo}-${hi}`;
}

export function teamName(
  league: LeagueSnapshot,
  teamId: number | null | undefined,
): string {
  if (teamId == null) return "TBD";
  return league.teams.find((t) => t.team_id === teamId)?.name ?? `Team ${teamId}`;
}

function slotRank(slot: string | null | undefined): number {
  const s = (slot ?? "").toUpperCase();
  const order = [
    "QB",
    "RB",
    "WR",
    "TE",
    "FLEX",
    "OP",
    "SUPERFLEX",
    "K",
    "D/ST",
    "DST",
    "DEF",
    "BE",
    "BN",
    "BENCH",
    "IR",
    "IL",
  ];
  const idx = order.indexOf(s);
  return idx === -1 ? 50 : idx;
}

/** Starters first, then bench/IR — stable within slot. */
export function sortLineup(players: BoxScorePlayer[]): BoxScorePlayer[] {
  return [...players].sort((a, b) => {
    const sa = slotRank(a.slot);
    const sb = slotRank(b.slot);
    if (sa !== sb) return sa - sb;
    return (b.points ?? 0) - (a.points ?? 0);
  });
}

export function isStarterSlot(slot: string | null | undefined): boolean {
  const s = (slot ?? "").toUpperCase();
  if (!s || s === "BE" || s === "BN" || s === "BENCH" || s === "IR" || s === "IL") {
    return false;
  }
  return STARTER_SLOTS.has(s) || !["FA", "NONE"].includes(s);
}

/**
 * Extract this player's lineup lines from one week file (usually 0–1 rows).
 * Does not invent rows for weeks where the player is absent.
 */
export function playerLinesInWeek(
  snapshot: WeekBoxScoreSnapshot | null | undefined,
  playerId: string | number,
): PlayerWeekLogRow[] {
  if (!snapshot?.matchups?.length) return [];
  const rows: PlayerWeekLogRow[] = [];
  const week = snapshot.week;
  for (const m of snapshot.matchups) {
    for (const side of [
      {
        lineup: m.home_lineup ?? [],
        teamId: m.home_team_id,
        opponentTeamId: m.away_team_id,
      },
      {
        lineup: m.away_lineup ?? [],
        teamId: m.away_team_id,
        opponentTeamId: m.home_team_id,
      },
    ] as const) {
      for (const p of side.lineup) {
        if (!samePlayerId(p.id, playerId)) continue;
        rows.push({
          week,
          teamId: side.teamId,
          opponentTeamId: side.opponentTeamId,
          slot: p.slot ?? null,
          points: p.points ?? null,
          projectedPoints: p.projected_points ?? null,
          proOpponent: p.pro_opponent ?? null,
          onByeWeek: Boolean(p.on_bye_week),
          isPlayoff: Boolean(m.is_playoff),
          name: p.name ?? null,
          position: p.position ?? null,
        });
      }
    }
  }
  return rows;
}

/** Aggregate player lines across week snapshots; sort by week ascending. */
export function buildPlayerWeekGameLog(
  snapshots: Array<WeekBoxScoreSnapshot | null | undefined>,
  playerId: string | number,
): PlayerWeekGameLog {
  const rows: PlayerWeekLogRow[] = [];
  for (const snap of snapshots) {
    rows.push(...playerLinesInWeek(snap, playerId));
  }
  rows.sort((a, b) => a.week - b.week || (a.teamId ?? 0) - (b.teamId ?? 0));
  const scored = rows
    .map((r) => r.points)
    .filter((p): p is number => p != null && !Number.isNaN(p));
  if (!scored.length) {
    return { rows, totalPoints: null, avgPoints: null };
  }
  const totalPoints = scored.reduce((a, b) => a + b, 0);
  return {
    rows,
    totalPoints,
    avgPoints: totalPoints / scored.length,
  };
}
