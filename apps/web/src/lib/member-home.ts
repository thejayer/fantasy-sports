/**
 * The signed-in member's dashboard (roadmap 7.2).
 *
 * The home page used to be a marketing hero selling a product the visitor had
 * already signed into. This assembles what a member actually opens the hub for —
 * their record, their current matchup, and what needs doing — entirely from data
 * already on disk. AUDIT-COMPETITIVE #1.
 *
 * Pure: every function here takes a snapshot and returns view data, so the home
 * page stays a server component and this stays unit-testable.
 */

import type { LeagueSnapshot, Team } from "@/lib/data";
import { buildGameLog, type GameLogRow } from "@/lib/game-log";
import { gamesForPeriod, isViewerGame, resolvePeriod, periodCount } from "@/lib/matchups";
import { recordLabel, winPctLabel, injuryTone } from "@/lib/league";
import { lineupClock, playerIsLocked } from "@/lib/golf-lineup";
import { golfReminderActionItem } from "@/lib/golf-lineup-reminder";

export type ActionTone = "urgent" | "attention" | "info";

export type ActionItem = {
  id: string;
  tone: ActionTone;
  label: string;
  href?: string;
};

export type HomeMatchup = {
  periodLabel: string;
  period: number;
  opponentName: string | null;
  opponentId: number | null;
  score: number | null;
  opponentScore: number | null;
  outcome: string;
  bye: boolean;
  decided: boolean;
};

export type HomeLeagueCard = {
  leagueId: string;
  name: string;
  sport: string;
  format: string;
  season: number;
  syncedAt?: string;
  periodLabel: string;
  currentPeriod: number | null;
  /** Null when the member has no franchise linked in this league. */
  team: {
    teamId: number;
    name: string;
    logoUrl?: string | null;
    record: string;
    winPct: string;
    standing: number | null;
    teamCount: number;
    pointsFor: number | null;
  } | null;
  matchup: HomeMatchup | null;
  next: GameLogRow | null;
  actions: ActionItem[];
  href: string;
};

const ORDER: Record<ActionTone, number> = { urgent: 0, attention: 1, info: 2 };

export function sortActions(actions: ActionItem[]): ActionItem[] {
  return [...actions].sort(
    (a, b) => ORDER[a.tone] - ORDER[b.tone] || a.label.localeCompare(b.label),
  );
}

/** Starters (not bench) whose injury status is worth a nudge. */
export function shakyStarters(team: Team): string[] {
  return team.roster
    .filter((player) => {
      const slot = (player.slot ?? "").toUpperCase();
      if (!slot || slot === "BE" || slot === "IR" || slot === "NA") return false;
      return injuryTone(player) !== "ok";
    })
    .map((player) => player.name ?? "Unnamed");
}

function currentMatchup(
  league: LeagueSnapshot,
  team: Team,
): HomeMatchup | null {
  const max = periodCount(league.teams);
  if (!max) return null;
  const period = resolvePeriod(undefined, league.current_week, max);
  const bundle = gamesForPeriod(league.teams, period);
  const periodLabel =
    league.period_label || (league.sport === "baseball" ? "period" : "week");

  const bye = bundle.byes.find((side) => side.teamId === team.team_id);
  if (bye) {
    return {
      periodLabel,
      period,
      opponentName: null,
      opponentId: null,
      score: bye.score,
      opponentScore: null,
      outcome: bye.outcome,
      bye: true,
      decided: false,
    };
  }

  const game = bundle.games.find((candidate) =>
    isViewerGame(candidate, team.team_id),
  );
  if (!game) return null;
  const mine = game.left.teamId === team.team_id ? game.left : game.right;
  const theirs = game.left.teamId === team.team_id ? game.right : game.left;
  const outcome = mine.outcome.toUpperCase();
  return {
    periodLabel,
    period,
    opponentName: theirs.name,
    opponentId: theirs.teamId,
    score: mine.score,
    opponentScore: theirs.score,
    outcome: mine.outcome,
    bye: false,
    decided: outcome === "W" || outcome === "L" || outcome === "T",
  };
}

/**
 * Golf lineup state for the current event. Locks are evaluated with the same
 * fail-closed `lineupClock` the Lineup UI and POST route use.
 */
export function golfLineupAction(
  league: LeagueSnapshot,
  team: Team,
): ActionItem | null {
  const lineups = league.lineups;
  const eventId = lineups?.current_event_id;
  if (!lineups || !eventId) return null;
  const event = lineups.events.find((item) => item.event_id === eventId);
  const saved = lineups.teams?.[String(team.team_id)]?.[eventId];
  const href = `/leagues/${league.league_id}?season=${league.season}&tab=lineup&event=${eventId}&team=${team.team_id}`;
  const eventName = event?.name ?? "the current event";

  if (!saved) {
    return {
      id: `golf-lineup-${eventId}`,
      tone: "urgent",
      label: `Set your lineup for ${eventName}`,
      href,
    };
  }

  const now = lineupClock(league.synced_at);
  const anyLocked = [
    ...saved.starters,
    saved.captain,
    saved.alt1,
    saved.alt2,
  ]
    .filter((id): id is number => id != null)
    .some((id) => playerIsLocked(id, event?.tee_times, now));

  if (anyLocked) {
    return {
      id: `golf-locked-${eventId}`,
      tone: "info",
      label: `${eventName} lineup is locked — tee times have passed`,
      href,
    };
  }

  return {
    id: `golf-lineup-ok-${eventId}`,
    tone: "info",
    label: `${eventName} lineup is set — still editable`,
    href,
  };
}

export function buildLeagueCard(
  league: LeagueSnapshot,
  viewerTeamId: number | undefined,
  options: { staleAfterMs?: number; now?: Date } = {},
): HomeLeagueCard {
  const periodLabel =
    league.period_label ||
    (league.sport === "golf" ? "event" : league.sport === "baseball" ? "period" : "week");
  const team =
    viewerTeamId != null
      ? (league.teams.find((item) => item.team_id === viewerTeamId) ?? null)
      : null;

  const actions: ActionItem[] = [];
  let matchup: HomeMatchup | null = null;
  let next: GameLogRow | null = null;

  if (!team) {
    actions.push({
      id: `link-${league.league_id}`,
      tone: "attention",
      label: "No franchise linked — pick your team in the admin center",
      href: "/admin",
    });
  } else {
    matchup = currentMatchup(league, team);
    next = buildGameLog(team, league.teams).next;

    if (league.sport === "golf") {
      // Prefer a timed tee-window reminder over the generic "set lineup" item.
      const timed = golfReminderActionItem(league, team.team_id, {
        now: options.now ?? lineupClock(league.synced_at),
      });
      if (timed) {
        actions.push(timed);
      } else {
        const golf = golfLineupAction(league, team);
        if (golf) actions.push(golf);
      }
    }

    const shaky = shakyStarters(team);
    if (shaky.length) {
      actions.push({
        id: `injuries-${league.league_id}`,
        tone: shaky.length > 2 ? "urgent" : "attention",
        label:
          shaky.length === 1
            ? `${shaky[0]} is not healthy in your starting lineup`
            : `${shaky.length} starters are not healthy: ${shaky.slice(0, 3).join(", ")}${shaky.length > 3 ? "…" : ""}`,
        href: `/leagues/${league.league_id}/teams/${team.team_id}?season=${league.season}`,
      });
    }
  }

  const staleAfterMs = options.staleAfterMs ?? 6 * 60 * 60 * 1000;
  if (league.synced_at) {
    const age =
      (options.now ?? new Date()).getTime() - new Date(league.synced_at).getTime();
    if (Number.isFinite(age) && age > staleAfterMs) {
      actions.push({
        id: `stale-${league.league_id}`,
        tone: "info",
        label: `Last synced ${relativeAge(age)} ago — scores may be behind`,
      });
    }
  }

  return {
    leagueId: league.league_id,
    name: league.name,
    sport: league.sport,
    format: league.format,
    season: league.season,
    syncedAt: league.synced_at,
    periodLabel,
    currentPeriod: league.current_week,
    team: team
      ? {
          teamId: team.team_id,
          name: team.name,
          logoUrl: team.logo_url,
          record: recordLabel(team),
          winPct: winPctLabel(team),
          standing: team.standing,
          teamCount: league.team_count,
          pointsFor: team.points_for,
        }
      : null,
    matchup,
    next,
    actions: sortActions(actions),
    href: `/leagues/${league.league_id}?season=${league.season}`,
  };
}

/** "3 days", "4 hours", "12 minutes" — coarse on purpose. */
export function relativeAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function syncedLabel(
  syncedAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!syncedAt) return null;
  const then = new Date(syncedAt).getTime();
  if (Number.isNaN(then)) return null;
  const age = now.getTime() - then;
  if (age < 0) return "just now";
  return `${relativeAge(age)} ago`;
}

/** Cards where the member has something to do, most urgent first. */
export function dashboardActions(cards: HomeLeagueCard[]): Array<
  ActionItem & { leagueName: string }
> {
  const rows = cards.flatMap((card) =>
    card.actions
      .filter((action) => action.tone !== "info")
      .map((action) => ({ ...action, leagueName: card.name })),
  );
  return sortActions(rows) as Array<ActionItem & { leagueName: string }>;
}
