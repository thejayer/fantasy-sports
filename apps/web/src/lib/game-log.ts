/**
 * One franchise's season results (roadmap 7.4).
 *
 * The v2 team fast path used to drop `schedule` / `scores` / `outcomes`, so team
 * pages showed a roster and no results at all. These helpers turn the parallel
 * arrays into the game log, next opponent, and score range that every competing
 * product puts on its team page.
 */

import type { Team } from "@/lib/data";

export type GameLogRow = {
  period: number;
  opponentId: number | null;
  opponentName: string | null;
  bye: boolean;
  score: number | null;
  opponentScore: number | null;
  outcome: string;
  /** No score on either side yet — an unplayed period. */
  upcoming: boolean;
};

export type GameLogSummary = {
  rows: GameLogRow[];
  played: GameLogRow[];
  next: GameLogRow | null;
  high: GameLogRow | null;
  low: GameLogRow | null;
  averageScore: number | null;
};

function isPlayed(row: { score: number | null; outcome: string }): boolean {
  if (row.score != null) return true;
  const outcome = row.outcome.toUpperCase();
  return outcome === "W" || outcome === "L" || outcome === "T";
}

export function buildGameLog(team: Team, allTeams: Team[]): GameLogSummary {
  const names = new Map(allTeams.map((item) => [item.team_id, item.name]));
  const scoresById = new Map(
    allTeams.map((item) => [item.team_id, item.scores ?? []]),
  );
  const schedule = team.schedule ?? [];
  const scores = team.scores ?? [];
  const outcomes = team.outcomes ?? [];

  const rows: GameLogRow[] = schedule.map((opponentId, index) => {
    const bye = opponentId != null && opponentId === team.team_id;
    const score = scores[index] ?? null;
    const outcome = String(outcomes[index] ?? "U");
    const opponentScore =
      bye || opponentId == null
        ? null
        : (scoresById.get(opponentId)?.[index] ?? null);
    return {
      period: index + 1,
      opponentId: bye ? null : (opponentId ?? null),
      opponentName: bye ? null : (names.get(opponentId ?? -1) ?? null),
      bye,
      score,
      opponentScore,
      outcome,
      upcoming: !isPlayed({ score, outcome }),
    };
  });

  const played = rows.filter((row) => !row.bye && !row.upcoming);
  const scored = played.filter((row) => row.score != null);
  const next = rows.find((row) => row.upcoming && !row.bye) ?? null;

  let high: GameLogRow | null = null;
  let low: GameLogRow | null = null;
  for (const row of scored) {
    if (!high || (row.score ?? 0) > (high.score ?? 0)) high = row;
    if (!low || (row.score ?? 0) < (low.score ?? 0)) low = row;
  }

  const averageScore = scored.length
    ? scored.reduce((sum, row) => sum + (row.score ?? 0), 0) / scored.length
    : null;

  return { rows, played, next, high, low, averageScore };
}

/**
 * Bar heights for the weekly score sparkline, normalised against the team's own
 * range so a flat season does not render as a flat line at zero.
 */
export function sparklineHeights(
  rows: GameLogRow[],
  min = 0.12,
): Array<{ period: number; height: number; row: GameLogRow }> {
  const scored = rows.filter((row) => row.score != null && !row.bye);
  if (!scored.length) return [];
  const values = scored.map((row) => row.score ?? 0);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  return scored.map((row) => ({
    period: row.period,
    row,
    height:
      span === 0 ? 1 : min + (1 - min) * (((row.score ?? 0) - lo) / span),
  }));
}
