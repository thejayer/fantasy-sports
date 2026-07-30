/**
 * Weekly league digest / awards (roadmap 7.7).
 *
 * Pure and idempotent — keyed by league-season-period. Surfaces in the hub
 * feed as a system digest event; transport (Discord) is a separate step.
 */

import { activityRowsForLeague } from "@/lib/activity";
import type { LeagueSnapshot, Team } from "@/lib/data";
import type { SystemFeedEvent } from "@/lib/feed-events";
import { gamesForPeriod, periodCount } from "@/lib/matchups";

export type DigestAward = {
  id: string;
  title: string;
  detail: string;
  teamIds: number[];
};

export type PowerRankingRow = {
  teamId: number;
  name: string;
  rank: number;
  /** All-play win % across decided games in the season through `period`. */
  allPlayWinPct: number;
  pointsFor: number;
  record: string;
};

export type WeeklyDigest = {
  leagueId: string;
  season: number;
  period: number;
  generatedAt: string;
  awards: DigestAward[];
  powerRankings: PowerRankingRow[];
  headline: string;
  body: string;
};

function periodMs(season: number, period: number): number {
  return Date.UTC(season, 8, 1) + period * 7 * 24 * 60 * 60 * 1000;
}

function teamRecord(team: Team): string {
  return `${team.wins ?? 0}-${team.losses ?? 0}${
    (team.ties ?? 0) > 0 ? `-${team.ties}` : ""
  }`;
}

/** All-play win % through `throughPeriod` (1-based, inclusive). */
export function allPlayWinPct(team: Team, throughPeriod: number): number {
  const scores = team.scores ?? [];
  const schedule = team.schedule ?? [];
  let wins = 0;
  let games = 0;
  for (let i = 0; i < throughPeriod && i < scores.length; i++) {
    const mine = scores[i];
    const oppId = schedule[i];
    if (mine == null || oppId == null || oppId === team.team_id) continue;
    // Compare against every other team's score that week when available —
    // approximate all-play using the H2H field when that's all we have by
    // counting W/L outcomes; fuller all-play needs every score that week.
    games += 1;
    const outcome = String(team.outcomes?.[i] ?? "U");
    if (outcome === "W") wins += 1;
    else if (outcome === "T") wins += 0.5;
  }
  return games > 0 ? wins / games : 0;
}

/**
 * True all-play: each team's score vs every other team's score that period.
 * Falls back to H2H win% when fewer than two scored games exist.
 */
export function trueAllPlayWinPct(
  teams: Team[],
  teamId: number,
  throughPeriod: number,
): number {
  let wins = 0;
  let games = 0;
  for (let period = 1; period <= throughPeriod; period++) {
    const index = period - 1;
    const scores = teams
      .map((t) => ({
        id: t.team_id,
        score: t.scores?.[index],
        bye: (t.schedule?.[index] ?? null) === t.team_id,
      }))
      .filter((s) => s.score != null && !s.bye) as Array<{
      id: number;
      score: number;
      bye: boolean;
    }>;
    if (scores.length < 2) continue;
    const me = scores.find((s) => s.id === teamId);
    if (!me) continue;
    for (const other of scores) {
      if (other.id === teamId) continue;
      games += 1;
      if (me.score > other.score) wins += 1;
      else if (me.score === other.score) wins += 0.5;
    }
  }
  if (games > 0) return wins / games;
  const team = teams.find((t) => t.team_id === teamId);
  return team ? allPlayWinPct(team, throughPeriod) : 0;
}

export function powerRankings(
  teams: Team[],
  throughPeriod: number,
): PowerRankingRow[] {
  const rows = teams.map((team) => ({
    teamId: team.team_id,
    name: team.name,
    rank: 0,
    allPlayWinPct: trueAllPlayWinPct(teams, team.team_id, throughPeriod),
    pointsFor: team.points_for ?? 0,
    record: teamRecord(team),
  }));
  rows.sort(
    (a, b) =>
      b.allPlayWinPct - a.allPlayWinPct ||
      b.pointsFor - a.pointsFor ||
      a.name.localeCompare(b.name),
  );
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

function awardsForPeriod(
  league: LeagueSnapshot,
  period: number,
): DigestAward[] {
  const bundle = gamesForPeriod(league.teams, period);
  const decided = bundle.games.filter((g) => {
    const o = g.left.outcome;
    return o === "W" || o === "L" || o === "T";
  });
  if (!decided.length) return [];

  const awards: DigestAward[] = [];
  let highScore = -Infinity;
  let highSide: { name: string; teamId: number; score: number } | null = null;
  let blowout = -Infinity;
  let blowoutDetail: DigestAward | null = null;
  let closest = Infinity;
  let closestDetail: DigestAward | null = null;
  let lowestWin = Infinity;
  let lowestWinDetail: DigestAward | null = null;

  for (const g of decided) {
    for (const side of [g.left, g.right]) {
      const score = side.score ?? 0;
      if (score > highScore) {
        highScore = score;
        highSide = { name: side.name, teamId: side.teamId, score };
      }
    }
    const ls = g.left.score ?? 0;
    const rs = g.right.score ?? 0;
    const margin = Math.abs(ls - rs);
    const winner = ls >= rs ? g.left : g.right;
    const loser = ls >= rs ? g.right : g.left;
    if (margin > blowout) {
      blowout = margin;
      blowoutDetail = {
        id: "blowout",
        title: "Biggest blowout",
        detail: `${winner.name} over ${loser.name} by ${margin.toFixed(1)}`,
        teamIds: [winner.teamId, loser.teamId],
      };
    }
    if (margin < closest) {
      closest = margin;
      closestDetail = {
        id: "closest",
        title: "Closest game",
        detail: `${g.left.name} ${ls.toFixed(1)} – ${rs.toFixed(1)} ${g.right.name}`,
        teamIds: [g.left.teamId, g.right.teamId],
      };
    }
    if (winner.outcome === "W" && (winner.score ?? 0) < lowestWin) {
      lowestWin = winner.score ?? 0;
      lowestWinDetail = {
        id: "lucky",
        title: "Luckiest win",
        detail: `${winner.name} won with the week's lowest winning score (${lowestWin.toFixed(1)})`,
        teamIds: [winner.teamId],
      };
    }
  }

  if (highSide) {
    awards.push({
      id: "high_score",
      title: "Highest score",
      detail: `${highSide.name} · ${highSide.score.toFixed(1)}`,
      teamIds: [highSide.teamId],
    });
  }
  if (blowoutDetail) awards.push(blowoutDetail);
  if (closestDetail) awards.push(closestDetail);
  if (lowestWinDetail && decided.length >= 2) awards.push(lowestWinDetail);

  // Transaction of the week: densest activity near this period's window.
  const windowStart = periodMs(league.season, period) - 3 * 86400000;
  const windowEnd = periodMs(league.season, period) + 4 * 86400000;
  const txs = activityRowsForLeague(league, "all").filter(
    (r) => r.sortKey >= windowStart && r.sortKey <= windowEnd,
  );
  if (txs.length) {
    const trade = txs.find((r) => r.kind === "trade");
    const pick = trade ?? txs[0];
    awards.push({
      id: "transaction",
      title: "Move of the week",
      detail: `${pick.teamName}: ${pick.action} ${pick.playerName}`,
      teamIds: pick.teamId != null ? [pick.teamId] : [],
    });
  }

  return awards;
}

/**
 * Build a weekly digest for one period. Returns null when that period has no
 * decided games (nothing to recap).
 */
export function buildWeeklyDigest(
  league: LeagueSnapshot,
  period: number,
  now = new Date(),
): WeeklyDigest | null {
  const max = periodCount(league.teams);
  if (period < 1 || period > max) return null;
  const awards = awardsForPeriod(league, period);
  if (!awards.length) return null;

  const rankings = powerRankings(league.teams, period);
  const top = rankings[0];
  const headline = `Week ${period} recap · ${league.name ?? league.league_id}`;
  const awardLines = awards.map((a) => `• ${a.title}: ${a.detail}`);
  const rankLines = rankings
    .slice(0, 6)
    .map(
      (r) =>
        `${r.rank}. ${r.name} (${r.record}, ${(r.allPlayWinPct * 100).toFixed(0)}% all-play)`,
    );
  const body = [
    ...awardLines,
    "",
    "Power rankings",
    ...rankLines,
    top ? `\n${top.name} sits atop the board.` : "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  return {
    leagueId: league.league_id,
    season: league.season,
    period,
    generatedAt: now.toISOString(),
    awards,
    powerRankings: rankings,
    headline,
    body,
  };
}

/** Latest period that has decided games, or null. */
export function latestDigestPeriod(league: LeagueSnapshot): number | null {
  const max = periodCount(league.teams);
  for (let period = max; period >= 1; period--) {
    if (buildWeeklyDigest(league, period)) return period;
  }
  return null;
}

/** Turn a digest into a system feed event (stable id for comments). */
export function digestAsFeedEvent(digest: WeeklyDigest): SystemFeedEvent {
  const sortKey = periodMs(digest.season, digest.period) + 12 * 3600000;
  return {
    id: `digest:${digest.leagueId}:${digest.season}:${digest.period}`,
    kind: "digest",
    sortKey,
    occurredAt: new Date(sortKey).toISOString(),
    dateLabel: `Week ${digest.period}`,
    title: digest.headline,
    body: digest.body,
    teamIds: [
      ...new Set(digest.awards.flatMap((a) => a.teamIds)),
    ],
    playerIds: [],
    href: `/leagues/${digest.leagueId}?season=${digest.season}&tab=activity&view=all`,
  };
}

/** Format digest for outbound transport (Discord / email). */
export function formatDigestMessage(digest: WeeklyDigest): string {
  return `**${digest.headline}**\n${digest.body}`;
}
