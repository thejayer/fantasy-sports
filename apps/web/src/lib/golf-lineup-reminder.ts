/**
 * Golf tee-time lineup reminders (roadmap 7.7 / 8.3).
 *
 * Pure builder — transport (Discord) and idempotency live elsewhere.
 * Locks stay fail-closed; this is the warning layer before first tee.
 */

import type { LeagueSnapshot } from "@/lib/data";
import { lineupClock, playerIsLocked } from "@/lib/golf-lineup";
import type { HubMember, HubMembersFile } from "@/lib/hub-members";
import { teamLinkForLeague } from "@/lib/hub-members";

/** Default windows before first relevant tee (ms). */
export const REMINDER_WINDOWS_MS = [
  24 * 60 * 60 * 1000, // 24h
  2 * 60 * 60 * 1000, // 2h
] as const;

export type GolfLineupReminder = {
  leagueId: string;
  season: number;
  eventId: string;
  eventName: string;
  teamId: number;
  teamName: string;
  memberEmail: string | null;
  /** Earliest unlocked tee among roster golfers (or event.starts_at). */
  firstTeeAt: string;
  /** Which window matched (ms before first tee). */
  windowMs: number;
  href: string;
  /** Idempotency key: league:season:event:team:window. */
  deliveryKey: string;
};

export type GolfReminderBatch = {
  leagueId: string;
  season: number;
  eventId: string;
  eventName: string;
  firstTeeAt: string;
  windowMs: number;
  reminders: GolfLineupReminder[];
  generatedAt: string;
};

function earliestTee(
  playerIds: number[],
  teeTimes: Record<string, string> | undefined,
  eventStartsAt: string,
  now: Date,
): Date | null {
  let earliest: Date | null = null;
  for (const id of playerIds) {
    if (playerIsLocked(id, teeTimes, now)) continue;
    const raw = teeTimes?.[String(id)];
    const tee = raw ? new Date(raw) : new Date(eventStartsAt);
    if (Number.isNaN(tee.getTime())) continue;
    if (!earliest || tee.getTime() < earliest.getTime()) earliest = tee;
  }
  if (!earliest) {
    const fallback = new Date(eventStartsAt);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  return earliest;
}

function lineupIsSet(
  league: LeagueSnapshot,
  teamId: number,
  eventId: string,
): boolean {
  const saved = league.lineups?.teams?.[String(teamId)]?.[eventId];
  return Boolean(saved?.starters?.length && saved.captain != null);
}

function matchingWindow(
  msUntilTee: number,
  windows: readonly number[],
): number | null {
  // Pick the smallest window the tee still falls inside
  // (e.g. 90 min → 2h window, not 24h).
  const sorted = [...windows].sort((a, b) => a - b);
  for (const w of sorted) {
    if (msUntilTee > 0 && msUntilTee <= w) return w;
  }
  return null;
}

/**
 * Build reminders for linked franchises that still need a lineup and whose
 * first unlocked tee falls inside a reminder window.
 */
export function buildGolfLineupReminders(
  league: LeagueSnapshot,
  members: HubMembersFile | null | undefined,
  options: {
    now?: Date;
    windowsMs?: readonly number[];
    /** When set, only this window (for admin "send now" of a specific band). */
    forceWindowMs?: number | null;
    /**
     * Admin poke: any franchise with an unset lineup and at least one unlocked
     * golfer (ignores 2h/24h bands). Idempotency key uses windowMs=0.
     */
    anyUnset?: boolean;
  } = {},
): GolfReminderBatch | null {
  if (league.sport !== "golf") return null;
  const lineups = league.lineups;
  const eventId = lineups?.current_event_id;
  if (!lineups || !eventId) return null;
  const event = lineups.events.find((e) => e.event_id === eventId);
  if (!event) return null;

  const now = options.now ?? lineupClock(league.synced_at);
  const windows = options.windowsMs ?? REMINDER_WINDOWS_MS;
  const reminders: GolfLineupReminder[] = [];
  let batchWindow: number | null = options.anyUnset
    ? 0
    : (options.forceWindowMs ?? null);
  let batchFirstTee: string | null = null;

  const memberList: HubMember[] = members?.members ?? [];

  for (const team of league.teams) {
    if (lineupIsSet(league, team.team_id, eventId)) continue;

    const rosterIds = (team.roster ?? [])
      .map((p) => Number(p.id))
      .filter((id) => Number.isFinite(id));
    // If every roster tee already passed, skip — locks already closed.
    const allLocked =
      rosterIds.length > 0 &&
      rosterIds.every((id) => playerIsLocked(id, event.tee_times, now));
    if (allLocked) continue;

    // Unset lineup: earliest unlocked roster tee, else event.starts_at.
    const firstTee =
      earliestTee(rosterIds, event.tee_times, event.starts_at, now) ??
      (() => {
        const fallback = new Date(event.starts_at);
        return Number.isNaN(fallback.getTime()) ? null : fallback;
      })();
    if (!firstTee) continue;

    const msUntil = firstTee.getTime() - now.getTime();
    let windowMs: number | null;
    if (options.anyUnset) {
      windowMs = 0;
    } else if (options.forceWindowMs != null) {
      if (msUntil <= 0 || msUntil > options.forceWindowMs) continue;
      windowMs = options.forceWindowMs;
    } else {
      windowMs = matchingWindow(msUntil, windows);
    }
    if (windowMs == null) continue;

    const link = memberList
      .map((m) => ({ member: m, link: teamLinkForLeague(m, league.league_id) }))
      .find((row) => row.link?.team_id === team.team_id);

    const firstTeeAt = firstTee.toISOString();
    batchWindow = windowMs;
    batchFirstTee = batchFirstTee ?? firstTeeAt;
    reminders.push({
      leagueId: league.league_id,
      season: league.season,
      eventId,
      eventName: event.name,
      teamId: team.team_id,
      teamName: team.name,
      memberEmail: link?.member.email ?? null,
      firstTeeAt,
      windowMs,
      href: `/leagues/${league.league_id}?season=${league.season}&tab=lineup&event=${eventId}&team=${team.team_id}`,
      deliveryKey: `${league.season}:${eventId}:${team.team_id}:${windowMs}`,
    });
  }

  if (!reminders.length || batchWindow == null || !batchFirstTee) return null;

  return {
    leagueId: league.league_id,
    season: league.season,
    eventId,
    eventName: event.name,
    firstTeeAt: batchFirstTee,
    windowMs: batchWindow,
    reminders,
    generatedAt: now.toISOString(),
  };
}

/** Discord / outbound body for a reminder batch. */
export function formatGolfReminderMessage(batch: GolfReminderBatch): string {
  const hours = batch.windowMs / (60 * 60 * 1000);
  const windowLabel =
    batch.windowMs <= 0
      ? "before locks"
      : hours >= 24
        ? `within ~${Math.round(hours / 24)}d`
        : `within ~${Math.round(hours)}h`;
  const lines = [
    `**Lineup reminder — ${batch.eventName}**`,
    `Set five starters ${windowLabel} (tee-time locks are fail-closed).`,
    "",
    ...batch.reminders.map((r) => {
      const who = r.memberEmail ? ` (${r.memberEmail})` : "";
      return `• **${r.teamName}**${who} → ${r.href}`;
    }),
  ];
  return lines.join("\n");
}

/**
 * Member-home action when a tee is approaching and lineup is unset.
 * Complements golfLineupAction with a timed urgency band.
 */
export function golfReminderActionItem(
  league: LeagueSnapshot,
  teamId: number,
  options: { now?: Date; windowsMs?: readonly number[] } = {},
): {
  id: string;
  tone: "urgent";
  label: string;
  href: string;
} | null {
  const batch = buildGolfLineupReminders(
    league,
    {
      schema_version: 1,
      updated_at: "",
      members: [
        {
          email: "viewer@local",
          role: "member",
          created_at: "",
          updated_at: "",
          teams: [
            {
              league_id: league.league_id,
              team_id: teamId,
            },
          ],
        },
      ],
    },
    options,
  );
  const hit = batch?.reminders.find((r) => r.teamId === teamId);
  if (!hit || !batch) return null;
  const hours = Math.max(1, Math.round(hit.windowMs / (60 * 60 * 1000)));
  return {
    id: `golf-reminder-${hit.eventId}-${hit.windowMs}`,
    tone: "urgent",
    label: `${batch.eventName}: set lineup — first tee within ~${hours}h`,
    href: hit.href,
  };
}
