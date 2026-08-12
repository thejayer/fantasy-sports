/**
 * "This day in SJ" — calendar anniversaries from league history (Track Q).
 *
 * Matchup weeks use the same Sep-1 + 7×period synthetic calendar as digests /
 * feed results. Real ESPN transaction dates and golf event starts_at use the
 * stored calendar day. Pure helpers — the home page assembles inputs.
 */

import { parseEspnActivityDate } from "@/lib/activity";
import type {
  LeagueHistoryArchive,
  LeagueSnapshot,
  SeasonHistorySlice,
  Transaction,
} from "@/lib/data";
import { buildWeeklyDigest, digestPeriodMs } from "@/lib/digest";
import { periodCount } from "@/lib/matchups";

export type OnThisDayMoment = {
  id: string;
  kind: "week_recap" | "transaction" | "golf_event";
  leagueId: string;
  leagueName: string;
  season: number;
  yearsAgo: number;
  title: string;
  detail: string;
  href: string;
  /** Short calendar label, e.g. "Sep 8". */
  whenLabel: string;
};

export function onThisDayClock(now = new Date()): Date {
  const raw = process.env.SJ_ON_THIS_DAY_NOW?.trim();
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return now;
}

export function sameUtcMonthDay(a: Date, b: Date): boolean {
  return (
    a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()
  );
}

export function formatMonthDay(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function yearsAgoLabel(yearsAgo: number, season: number): string {
  if (yearsAgo <= 0) return String(season);
  return `${season} · ${yearsAgo} year${yearsAgo === 1 ? "" : "s"} ago`;
}

/** Minimal snapshot so digest / matchup helpers can run on a history slice. */
export function snapshotFromHistorySlice(
  archive: LeagueHistoryArchive,
  slice: SeasonHistorySlice,
  extras?: { transactions?: Transaction[]; lineups?: LeagueSnapshot["lineups"] },
): LeagueSnapshot {
  return {
    league_id: archive.league_id,
    espn_league_id: null,
    sport: archive.sport,
    format: archive.format,
    season: slice.season,
    name: archive.name,
    team_count: slice.teams.length,
    current_week: null,
    period_label: slice.period_label,
    transactions: extras?.transactions,
    lineups: extras?.lineups,
    teams: slice.teams.map((team) => ({
      team_id: team.team_id,
      name: team.name,
      abbrev: team.abbrev,
      owners: team.owners,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      points_for: team.points_for,
      points_against: team.points_against,
      standing: team.standing,
      final_standing: team.final_standing,
      division: "",
      schedule: team.schedule,
      scores: team.scores,
      outcomes: team.outcomes,
      roster: [],
    })),
    players: [],
  };
}

function weekRecapMoments(
  league: LeagueSnapshot,
  now: Date,
): OnThisDayMoment[] {
  const max = periodCount(league.teams);
  const moments: OnThisDayMoment[] = [];
  for (let period = 1; period <= max; period++) {
    const when = new Date(digestPeriodMs(league.season, period));
    if (!sameUtcMonthDay(when, now)) continue;
    const digest = buildWeeklyDigest(league, period, now);
    if (!digest) continue;
    const top = digest.awards[0];
    const yearsAgo = Math.max(0, now.getUTCFullYear() - league.season);
    moments.push({
      id: `week:${league.league_id}:${league.season}:${period}`,
      kind: "week_recap",
      leagueId: league.league_id,
      leagueName: league.name || league.league_id,
      season: league.season,
      yearsAgo,
      title: `Week ${period} · ${yearsAgoLabel(yearsAgo, league.season)}`,
      detail: top
        ? `${top.title}: ${top.detail}`
        : digest.headline,
      href: `/leagues/${league.league_id}?season=${league.season}&tab=matchups&week=${period}`,
      whenLabel: formatMonthDay(when),
    });
  }
  return moments;
}

function transactionMoments(
  league: LeagueSnapshot,
  now: Date,
): OnThisDayMoment[] {
  const moments: OnThisDayMoment[] = [];
  const seen = new Set<string>();
  for (const [index, tx] of (league.transactions ?? []).entries()) {
    const when = parseEspnActivityDate(tx.date);
    if (!when || !sameUtcMonthDay(when, now)) continue;
    // Skip same calendar year "today" noise unless it's a prior year anniversary.
    const yearsAgo = now.getUTCFullYear() - when.getUTCFullYear();
    if (yearsAgo < 0) continue;
    const action = tx.actions?.[0];
    const detail = action
      ? `${action.action} ${action.player_name ?? "a player"}`
      : "League transaction";
    const id = `tx:${league.league_id}:${when.toISOString().slice(0, 10)}:${index}`;
    if (seen.has(id)) continue;
    seen.add(id);
    moments.push({
      id,
      kind: "transaction",
      leagueId: league.league_id,
      leagueName: league.name || league.league_id,
      season: league.season,
      yearsAgo,
      title:
        yearsAgo > 0
          ? `Move · ${yearsAgoLabel(yearsAgo, when.getUTCFullYear())}`
          : `Move · ${formatMonthDay(when)}`,
      detail,
      href: `/leagues/${league.league_id}?season=${league.season}&tab=activity&view=waivers`,
      whenLabel: formatMonthDay(when),
    });
  }
  return moments;
}

function golfEventMoments(
  league: LeagueSnapshot,
  now: Date,
): OnThisDayMoment[] {
  if (league.sport !== "golf") return [];
  const moments: OnThisDayMoment[] = [];
  for (const event of league.lineups?.events ?? []) {
    const raw = event.starts_at?.trim();
    if (!raw) continue;
    const when = new Date(raw);
    if (Number.isNaN(when.getTime()) || !sameUtcMonthDay(when, now)) continue;
    const yearsAgo = Math.max(0, now.getUTCFullYear() - when.getUTCFullYear());
    moments.push({
      id: `golf:${league.league_id}:${event.event_id}`,
      kind: "golf_event",
      leagueId: league.league_id,
      leagueName: league.name || league.league_id,
      season: league.season,
      yearsAgo,
      title: event.name?.trim() || "Golf event",
      detail:
        yearsAgo > 0
          ? `Tee time week · ${yearsAgoLabel(yearsAgo, when.getUTCFullYear())}`
          : "Tee time week on the calendar",
      href: `/leagues/${league.league_id}?season=${league.season}&tab=scoreboard`,
      whenLabel: formatMonthDay(when),
    });
  }
  return moments;
}

export type OnThisDayLeagueInput = {
  archive: LeagueHistoryArchive | null;
  /** Full current (or any) snapshots — used for txs / golf / seasons missing from archive. */
  snapshots: LeagueSnapshot[];
};

/**
 * Collect anniversary moments for the UTC month/day of `now`.
 * Prefer history archive seasons; overlay full snapshots for richer concerns.
 */
export function collectOnThisDay(
  inputs: OnThisDayLeagueInput[],
  now: Date,
  opts?: { limit?: number },
): OnThisDayMoment[] {
  const limit = opts?.limit ?? 6;
  const moments: OnThisDayMoment[] = [];
  const coveredWeeks = new Set<string>();

  for (const input of inputs) {
    const snapBySeason = new Map(
      input.snapshots.map((s) => [s.season, s] as const),
    );

    if (input.archive) {
      for (const slice of input.archive.seasons) {
        const key = `${input.archive.league_id}:${slice.season}`;
        const full = snapBySeason.get(slice.season);
        const league = snapshotFromHistorySlice(input.archive, slice, {
          transactions: full?.transactions,
          lineups: full?.lineups,
        });
        coveredWeeks.add(key);
        moments.push(...weekRecapMoments(league, now));
        moments.push(...transactionMoments(league, now));
        moments.push(...golfEventMoments(league, now));
      }
    }

    for (const snap of input.snapshots) {
      const key = `${snap.league_id}:${snap.season}`;
      if (!coveredWeeks.has(key)) {
        moments.push(...weekRecapMoments(snap, now));
      }
      // Full snaps always own txs / golf (history archive omits those concerns).
      moments.push(...transactionMoments(snap, now));
      moments.push(...golfEventMoments(snap, now));
    }
  }

  const byId = new Map<string, OnThisDayMoment>();
  for (const moment of moments) {
    if (!byId.has(moment.id)) byId.set(moment.id, moment);
  }

  return [...byId.values()]
    .sort(
      (a, b) =>
        b.yearsAgo - a.yearsAgo ||
        a.leagueName.localeCompare(b.leagueName) ||
        a.title.localeCompare(b.title),
    )
    .slice(0, limit);
}
