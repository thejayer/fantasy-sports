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
