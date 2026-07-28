import type { Team } from "@/lib/data";

export type MatchupSide = {
  teamId: number;
  name: string;
  abbrev: string | null;
  standing: number | null;
  score: number | null;
  outcome: string;
};

export type MatchupGame = {
  period: number;
  left: MatchupSide;
  right: MatchupSide;
  /** True when opponents were inferred from standings seeds, not snapshot scores. */
  projected?: boolean;
};

export type PeriodBundle = {
  period: number;
  games: MatchupGame[];
  byes: MatchupSide[];
};

function sideFromTeam(
  team: Team,
  index: number,
): MatchupSide {
  const scores = team.scores ?? [];
  const outcomes = team.outcomes ?? [];
  return {
    teamId: team.team_id,
    name: team.name,
    abbrev: team.abbrev,
    standing: team.standing,
    score: index >= 0 ? (scores[index] ?? null) : null,
    outcome: index >= 0 ? String(outcomes[index] ?? "U") : "U",
  };
}

/** Number of matchup periods present on any team (0 if none). */
export function periodCount(teams: Team[]): number {
  let max = 0;
  for (const team of teams) {
    const n = team.schedule?.length ?? 0;
    if (n > max) max = n;
  }
  return max;
}

/**
 * Clamp a requested 1-based period into [1, max]. Prefers `currentWeek` when
 * the request is missing/invalid; falls back to 1.
 */
export function resolvePeriod(
  requested: number | undefined,
  currentWeek: number | null | undefined,
  max: number,
): number {
  if (max <= 0) return 1;
  if (requested != null && Number.isFinite(requested) && requested >= 1) {
    return Math.min(Math.floor(requested), max);
  }
  if (currentWeek != null && Number.isFinite(currentWeek) && currentWeek >= 1) {
    return Math.min(Math.floor(currentWeek), max);
  }
  return 1;
}

/** Pair teams for one 1-based period. Bye = opponent id equals self. */
export function gamesForPeriod(teams: Team[], period: number): PeriodBundle {
  const index = period - 1;
  const byId = new Map(teams.map((team) => [team.team_id, team]));
  const games: MatchupGame[] = [];
  const byes: MatchupSide[] = [];
  const seen = new Set<string>();

  for (const team of teams) {
    const schedule = team.schedule ?? [];
    if (index < 0 || index >= schedule.length) continue;
    const opponentId = schedule[index];
    if (opponentId == null) continue;

    if (opponentId === team.team_id) {
      byes.push(sideFromTeam(team, index));
      continue;
    }

    const key = [team.team_id, opponentId].sort((a, b) => a - b).join(":");
    if (seen.has(key)) continue;
    seen.add(key);

    const opponent = byId.get(opponentId);
    if (!opponent) continue;

    // Stable left/right: lower team_id on the left (home/away lost in arrays).
    const [leftTeam, rightTeam] =
      team.team_id <= opponentId ? [team, opponent] : [opponent, team];
    games.push({
      period,
      left: sideFromTeam(leftTeam, index),
      right: sideFromTeam(rightTeam, index),
    });
  }

  games.sort((a, b) => a.left.teamId - b.left.teamId);
  byes.sort((a, b) => a.teamId - b.teamId);
  return { period, games, byes };
}

/** Every period with its games/byes (for the season schedule view). */
export function seasonSchedule(teams: Team[]): PeriodBundle[] {
  const max = periodCount(teams);
  const out: PeriodBundle[] = [];
  for (let period = 1; period <= max; period += 1) {
    out.push(gamesForPeriod(teams, period));
  }
  return out;
}

export function isPlayoffPeriod(
  period: number,
  regSeasonCount: number | null | undefined,
): boolean {
  if (regSeasonCount == null || !Number.isFinite(regSeasonCount)) return false;
  return period > regSeasonCount;
}

/** 1-based periods after the regular season that exist in the snapshot. */
export function playoffPeriods(
  regSeasonCount: number | null | undefined,
  maxPeriod: number,
): number[] {
  if (regSeasonCount == null || !Number.isFinite(regSeasonCount)) return [];
  const start = Math.floor(regSeasonCount) + 1;
  const out: number[] = [];
  for (let period = start; period <= maxPeriod; period += 1) {
    out.push(period);
  }
  return out;
}

/** Top N teams by standing (missing standing sorts last). */
export function playoffSeeds(
  teams: Team[],
  playoffTeamCount: number | null | undefined,
): Team[] {
  const count =
    playoffTeamCount != null && Number.isFinite(playoffTeamCount)
      ? Math.max(0, Math.floor(playoffTeamCount))
      : 0;
  if (!count) return [];
  return [...teams]
    .sort((a, b) => {
      const sa = a.standing ?? Number.POSITIVE_INFINITY;
      const sb = b.standing ?? Number.POSITIVE_INFINITY;
      if (sa !== sb) return sa - sb;
      return a.team_id - b.team_id;
    })
    .slice(0, count);
}

/**
 * Classic 1-vs-N, 2-vs-(N-1) first-round pairings from seeds.
 * Scores/outcomes are empty — use only when the snapshot has no playoff periods.
 */
export function projectedFirstRound(seeds: Team[]): MatchupGame[] {
  if (seeds.length < 2) return [];
  const games: MatchupGame[] = [];
  let lo = 0;
  let hi = seeds.length - 1;
  while (lo < hi) {
    const leftTeam = seeds[lo];
    const rightTeam = seeds[hi];
    games.push({
      period: 0,
      projected: true,
      left: {
        teamId: leftTeam.team_id,
        name: leftTeam.name,
        abbrev: leftTeam.abbrev,
        standing: leftTeam.standing,
        score: null,
        outcome: "U",
      },
      right: {
        teamId: rightTeam.team_id,
        name: rightTeam.name,
        abbrev: rightTeam.abbrev,
        standing: rightTeam.standing,
        score: null,
        outcome: "U",
      },
    });
    lo += 1;
    hi -= 1;
  }
  return games;
}

export function formatMatchupScore(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return "—";
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

export function outcomeTone(outcome: string): "win" | "loss" | "tie" | "open" {
  const value = outcome.toUpperCase();
  if (value === "W") return "win";
  if (value === "L") return "loss";
  if (value === "T") return "tie";
  return "open";
}
