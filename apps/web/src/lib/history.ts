import type {
  HistoryTeam,
  LeagueHistoryArchive,
  SeasonHistorySlice,
} from "@/lib/data";

export type AllTimeStanding = {
  teamId: number;
  name: string;
  abbrev: string | null;
  owners: string[];
  seasons: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  championships: number;
  winPct: number;
};

export type ChampionRow = {
  season: number;
  teamId: number;
  name: string;
  owners: string[];
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number | null;
};

export type RecordEntry = {
  label: string;
  value: string;
  detail: string;
  teamId?: number;
  season?: number;
  period?: number;
};

export type HeadToHeadGame = {
  season: number;
  period: number;
  teamScore: number | null;
  oppScore: number | null;
  outcome: string;
};

export type HeadToHeadSummary = {
  teamId: number;
  opponentId: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  games: HeadToHeadGame[];
};

function winPct(wins: number, losses: number, ties: number): number {
  const games = wins + losses + ties;
  if (!games) return 0;
  return (wins + 0.5 * ties) / games;
}

function formatRecord(wins: number, losses: number, ties: number): string {
  return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

export function formatWinPct(value: number): string {
  return value.toFixed(3).replace(/^0/, "");
}

export function formatPoints(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Prefer the most recent season's name/owners for a franchise. */
function latestIdentity(
  archive: LeagueHistoryArchive,
  teamId: number,
): Pick<HistoryTeam, "name" | "abbrev" | "owners"> {
  for (let i = archive.seasons.length - 1; i >= 0; i -= 1) {
    const team = archive.seasons[i].teams.find((t) => t.team_id === teamId);
    if (team) {
      return { name: team.name, abbrev: team.abbrev, owners: team.owners };
    }
  }
  return { name: `Team ${teamId}`, abbrev: null, owners: [] };
}

export function allTimeStandings(archive: LeagueHistoryArchive): AllTimeStanding[] {
  const byId = new Map<number, AllTimeStanding>();

  for (const slice of archive.seasons) {
    for (const team of slice.teams) {
      const existing = byId.get(team.team_id);
      const row =
        existing ??
        ({
          teamId: team.team_id,
          name: team.name,
          abbrev: team.abbrev,
          owners: team.owners,
          seasons: 0,
          wins: 0,
          losses: 0,
          ties: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          championships: 0,
          winPct: 0,
        } satisfies AllTimeStanding);

      row.seasons += 1;
      row.wins += team.wins;
      row.losses += team.losses;
      row.ties += team.ties;
      row.pointsFor += team.points_for ?? 0;
      row.pointsAgainst += team.points_against ?? 0;
      if (team.standing === 1) row.championships += 1;
      // Keep newest identity as we walk seasons ascending.
      row.name = team.name;
      row.abbrev = team.abbrev;
      row.owners = team.owners;
      byId.set(team.team_id, row);
    }
  }

  return [...byId.values()]
    .map((row) => ({
      ...row,
      winPct: winPct(row.wins, row.losses, row.ties),
    }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.winPct !== a.winPct) return b.winPct - a.winPct;
      if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
      return a.teamId - b.teamId;
    });
}

/** Regular-season #1 finishers by year (playoff champ not in snapshot). */
export function championsBySeason(archive: LeagueHistoryArchive): ChampionRow[] {
  const rows: ChampionRow[] = [];
  for (const slice of archive.seasons) {
    const champ = [...slice.teams]
      .filter((team) => team.standing != null)
      .sort((a, b) => (a.standing ?? 99) - (b.standing ?? 99))[0];
    if (!champ || champ.standing !== 1) continue;
    rows.push({
      season: slice.season,
      teamId: champ.team_id,
      name: champ.name,
      owners: champ.owners,
      wins: champ.wins,
      losses: champ.losses,
      ties: champ.ties,
      pointsFor: champ.points_for,
    });
  }
  return rows.sort((a, b) => b.season - a.season);
}

function pushBest(
  current: RecordEntry | null,
  candidate: RecordEntry,
  numeric: number,
  bestNumeric: number,
  preferHigher: boolean,
): { entry: RecordEntry; value: number } {
  const better =
    current == null ||
    (preferHigher ? numeric > bestNumeric : numeric < bestNumeric);
  if (better || current == null) {
    return { entry: candidate, value: numeric };
  }
  return { entry: current, value: bestNumeric };
}

export function buildRecordBook(archive: LeagueHistoryArchive): RecordEntry[] {
  let bestSeasonWins: RecordEntry | null = null;
  let bestSeasonWinsN = -1;
  let bestSeasonPf: RecordEntry | null = null;
  let bestSeasonPfN = -1;
  let bestWeek: RecordEntry | null = null;
  let bestWeekN = -1;
  let worstWeek: RecordEntry | null = null;
  let worstWeekN = Number.POSITIVE_INFINITY;

  for (const slice of archive.seasons) {
    for (const team of slice.teams) {
      const seasonWins = pushBest(
        bestSeasonWins,
        {
          label: "Most wins (season)",
          value: String(team.wins),
          detail: `${team.name} · ${slice.season}`,
          teamId: team.team_id,
          season: slice.season,
        },
        team.wins,
        bestSeasonWinsN,
        true,
      );
      bestSeasonWins = seasonWins.entry;
      bestSeasonWinsN = seasonWins.value;

      if (team.points_for != null) {
        const seasonPf = pushBest(
          bestSeasonPf,
          {
            label: "Most points (season)",
            value: formatPoints(team.points_for),
            detail: `${team.name} · ${slice.season}`,
            teamId: team.team_id,
            season: slice.season,
          },
          team.points_for,
          bestSeasonPfN,
          true,
        );
        bestSeasonPf = seasonPf.entry;
        bestSeasonPfN = seasonPf.value;
      }

      for (let i = 0; i < team.scores.length; i += 1) {
        const score = team.scores[i];
        if (score == null || Number.isNaN(score)) continue;
        // Skip bye placeholders (opponent == self and score 0).
        const opp = team.schedule[i];
        if (opp === team.team_id && score === 0) continue;

        const weekHigh = pushBest(
          bestWeek,
          {
            label: "Highest weekly score",
            value: formatPoints(score),
            detail: `${team.name} · ${slice.season} ${slice.period_label || "week"} ${i + 1}`,
            teamId: team.team_id,
            season: slice.season,
            period: i + 1,
          },
          score,
          bestWeekN,
          true,
        );
        bestWeek = weekHigh.entry;
        bestWeekN = weekHigh.value;

        const weekLow = pushBest(
          worstWeek,
          {
            label: "Lowest weekly score",
            value: formatPoints(score),
            detail: `${team.name} · ${slice.season} ${slice.period_label || "week"} ${i + 1}`,
            teamId: team.team_id,
            season: slice.season,
            period: i + 1,
          },
          score,
          worstWeekN,
          false,
        );
        worstWeek = weekLow.entry;
        worstWeekN = weekLow.value;
      }
    }
  }

  const titles = allTimeStandings(archive);
  const mostTitles = titles[0]
    ? titles.reduce((best, row) =>
        row.championships > best.championships ? row : best,
      )
    : null;

  const entries: RecordEntry[] = [];
  if (bestSeasonWins) entries.push(bestSeasonWins);
  if (bestSeasonPf) entries.push(bestSeasonPf);
  if (bestWeek) entries.push(bestWeek);
  if (worstWeek && Number.isFinite(worstWeekN)) entries.push(worstWeek);
  if (mostTitles && mostTitles.championships > 0) {
    entries.push({
      label: "Most #1 finishes",
      value: String(mostTitles.championships),
      detail: mostTitles.name,
      teamId: mostTitles.teamId,
    });
  }
  return entries;
}

/**
 * Aggregate H2H from each team's perspective using schedule/outcomes.
 * Counts each contest once (only when team_id < opponent_id would double —
 * we always walk `teamId`'s rows only).
 */
export function headToHead(
  archive: LeagueHistoryArchive,
  teamId: number,
  opponentId: number,
): HeadToHeadSummary {
  const summary: HeadToHeadSummary = {
    teamId,
    opponentId,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    games: [],
  };
  if (teamId === opponentId) return summary;

  for (const slice of archive.seasons) {
    const team = slice.teams.find((t) => t.team_id === teamId);
    const opp = slice.teams.find((t) => t.team_id === opponentId);
    if (!team || !opp) continue;

    const n = Math.min(team.schedule.length, team.outcomes.length, team.scores.length);
    for (let i = 0; i < n; i += 1) {
      if (team.schedule[i] !== opponentId) continue;
      const outcome = String(team.outcomes[i] ?? "U").toUpperCase();
      if (outcome === "U") continue;
      const teamScore = team.scores[i] ?? null;
      const oppScore = opp.scores[i] ?? null;
      if (outcome === "W") summary.wins += 1;
      else if (outcome === "L") summary.losses += 1;
      else if (outcome === "T") summary.ties += 1;
      summary.pointsFor += teamScore ?? 0;
      summary.pointsAgainst += oppScore ?? 0;
      summary.games.push({
        season: slice.season,
        period: i + 1,
        teamScore,
        oppScore,
        outcome,
      });
    }
  }

  summary.games.sort((a, b) => b.season - a.season || b.period - a.period);
  return summary;
}

export function franchiseOptions(archive: LeagueHistoryArchive): Array<{
  teamId: number;
  name: string;
}> {
  return allTimeStandings(archive).map((row) => ({
    teamId: row.teamId,
    name: row.name,
  }));
}

export function defaultH2HPair(
  archive: LeagueHistoryArchive,
): { a: number; b: number } | null {
  const opts = franchiseOptions(archive);
  if (opts.length < 2) return null;
  return { a: opts[0].teamId, b: opts[1].teamId };
}

export function recordLabelFromCounts(
  wins: number,
  losses: number,
  ties: number,
): string {
  return formatRecord(wins, losses, ties);
}

export type FranchiseSeasonRow = {
  season: number;
  name: string;
  owners: string[];
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  pointsFor: number | null;
  pointsAgainst: number | null;
  standing: number | null;
  /** Best and worst scored period that season. */
  high: number | null;
  low: number | null;
};

export type FranchiseCareer = {
  teamId: number;
  name: string;
  abbrev: string | null;
  owners: string[];
  seasons: FranchiseSeasonRow[];
  totals: AllTimeStanding | null;
  /** Every other franchise this one has played, by series record. */
  rivals: Array<HeadToHeadSummary & { name: string; winPct: number }>;
};

/**
 * One franchise's career across every season on disk (roadmap 7.3).
 * Keyed by `team_id` like the rest of phase 3.5 — owner names change.
 */
export function franchiseCareer(
  archive: LeagueHistoryArchive,
  teamId: number,
): FranchiseCareer | null {
  const appearances = archive.seasons.filter((slice) =>
    slice.teams.some((team) => team.team_id === teamId),
  );
  if (!appearances.length) return null;

  const seasons: FranchiseSeasonRow[] = appearances.map((slice) => {
    const team = slice.teams.find((t) => t.team_id === teamId)!;
    let high: number | null = null;
    let low: number | null = null;
    for (let i = 0; i < team.scores.length; i += 1) {
      const score = team.scores[i];
      if (score == null || Number.isNaN(score)) continue;
      // Skip bye placeholders, same rule as the record book.
      if (team.schedule[i] === team.team_id && score === 0) continue;
      if (high == null || score > high) high = score;
      if (low == null || score < low) low = score;
    }
    return {
      season: slice.season,
      name: team.name,
      owners: team.owners,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      winPct: winPct(team.wins, team.losses, team.ties),
      pointsFor: team.points_for,
      pointsAgainst: team.points_against,
      standing: team.standing,
      high,
      low,
    };
  });
  seasons.sort((a, b) => b.season - a.season);

  const identity = latestIdentity(archive, teamId);
  const totals =
    allTimeStandings(archive).find((row) => row.teamId === teamId) ?? null;

  const opponentIds = new Set<number>();
  for (const slice of archive.seasons) {
    const team = slice.teams.find((t) => t.team_id === teamId);
    if (!team) continue;
    for (const opponentId of team.schedule) {
      if (opponentId != null && opponentId !== teamId) {
        opponentIds.add(opponentId);
      }
    }
  }

  const rivals = [...opponentIds]
    .map((opponentId) => {
      const summary = headToHead(archive, teamId, opponentId);
      return {
        ...summary,
        name: latestIdentity(archive, opponentId).name,
        winPct: winPct(summary.wins, summary.losses, summary.ties),
      };
    })
    .filter((row) => row.games.length > 0)
    .sort(
      (a, b) => b.games.length - a.games.length || a.name.localeCompare(b.name),
    );

  return {
    teamId,
    name: identity.name,
    abbrev: identity.abbrev,
    owners: identity.owners,
    seasons,
    totals,
    rivals,
  };
}

export function seasonCountLabel(archive: LeagueHistoryArchive): string {
  const n = archive.seasons.length;
  if (!n) return "No seasons";
  const first = archive.seasons[0].season;
  const last = archive.seasons[n - 1].season;
  return n === 1 ? `${n} season (${first})` : `${n} seasons (${first}–${last})`;
}

/** Exported for tests — identity helper. */
export function identityForTeam(
  archive: LeagueHistoryArchive,
  teamId: number,
): ReturnType<typeof latestIdentity> {
  return latestIdentity(archive, teamId);
}

export type { SeasonHistorySlice };
