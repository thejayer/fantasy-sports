/**
 * Weekly golf lineups + tee-time locks (roadmap 6.4c).
 * Mirrors `src/sg/lineup.py` / `src/sg/schedule.py` for hub create + form.
 */

import {
  DEFAULT_GOLF_SETTINGS,
  GOLF_STARTERS,
  type GolfSettings,
  parseGolfSettings,
} from "@/lib/golf";
import type { Player, Team } from "@/lib/data";

export type GolfEventMeta = {
  event_id: string;
  name: string;
  week: number;
  starts_at: string;
  multiplier_tier: "regular" | "signature" | "major" | string;
  segment_id?: string | null;
  through_round?: number | null;
  tee_times?: Record<string, string>;
};

export type GolfWeekLineup = {
  starters: number[];
  captain: number;
  alt1?: number | null;
  alt2?: number | null;
  saved_at: string;
  locked_at?: string | null;
  locks?: Record<string, string>;
  source?: "manual" | "auto_pick" | "seed" | string;
};

export type GolfLineupsFile = {
  period_label?: string;
  current_event_id: string | null;
  events: GolfEventMeta[];
  teams: Record<string, Record<string, GolfWeekLineup>>;
};

/** Deterministic fixture clock (matches Python `FIXTURE_NOW`). */
export const GOLF_FIXTURE_NOW = "2026-03-12T14:00:00+00:00";

/**
 * Wall clock for lock checks. Committed fixtures use a fixed `synced_at`
 * (`2026-07-27…`); evaluate tee times against `GOLF_FIXTURE_NOW` so R1 locks
 * stay demoable long after the fixture event dates have passed.
 */
export function lineupClock(syncedAt: string | null | undefined): Date {
  if (syncedAt?.startsWith("2026-07-27")) {
    return new Date(GOLF_FIXTURE_NOW);
  }
  return new Date();
}

export function fixtureEvents(season: number): GolfEventMeta[] {
  return [
    {
      event_id: `${season}-players`,
      name: "THE PLAYERS Championship",
      week: 1,
      starts_at: `${season}-03-12T12:00:00+00:00`,
      multiplier_tier: "signature",
      segment_id: "early",
      through_round: 4,
    },
    {
      event_id: `${season}-masters`,
      name: "Masters Tournament",
      week: 2,
      starts_at: `${season}-04-09T12:00:00+00:00`,
      multiplier_tier: "major",
      segment_id: "early",
      through_round: 4,
    },
  ];
}

function toFixtureIso(date: Date): string {
  // Always emit +00:00 so lock checks match Python fixture stamps.
  return date.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function teeTimesForRoster(
  playerIds: number[],
  eventStartsAt: string,
): Record<string, string> {
  const start = new Date(eventStartsAt);
  const out: Record<string, string> = {};
  playerIds.forEach((playerId, index) => {
    const tee = new Date(start.getTime() + index * 30 * 60_000);
    out[String(playerId)] = toFixtureIso(tee);
  });
  return out;
}

export function playerIsLocked(
  playerId: number | string,
  teeTimes: Record<string, string> | undefined,
  now: Date = new Date(),
): boolean {
  if (!teeTimes) return false;
  const raw = teeTimes[String(playerId)];
  if (!raw) return false;
  return now.getTime() >= new Date(raw).getTime();
}

export function defaultLineupFromRoster(
  roster: Player[],
  golf: GolfSettings = DEFAULT_GOLF_SETTINGS,
  savedAt: string,
): GolfWeekLineup {
  const ids = roster
    .map((p) => (p.id == null ? null : Number(p.id)))
    .filter((id): id is number => id != null && !Number.isNaN(id));
  const startersN = golf.roster.starters || GOLF_STARTERS;
  const starters = ids.slice(0, startersN);
  const bench = ids.slice(startersN);
  const alt1 =
    golf.missed_cut.mode === "alt1" || golf.missed_cut.mode === "alt1_2"
      ? (bench[0] ?? null)
      : null;
  const alt2 =
    golf.missed_cut.mode === "alt1_2" ? (bench[1] ?? null) : null;
  return {
    starters,
    captain: starters[0]!,
    alt1,
    alt2,
    saved_at: savedAt,
    locked_at: null,
    locks: {},
    source: "seed",
  };
}

export function applyLocks(
  lineup: GolfWeekLineup,
  teeTimes: Record<string, string> | undefined,
  now: Date = new Date(),
): GolfWeekLineup {
  const locks = { ...(lineup.locks ?? {}) };
  const involved = [
    ...lineup.starters,
    lineup.captain,
    lineup.alt1,
    lineup.alt2,
  ].filter((x): x is number => x != null);
  for (const pid of involved) {
    if (playerIsLocked(pid, teeTimes, now)) {
      locks[String(pid)] = teeTimes?.[String(pid)] ?? now.toISOString();
    }
  }
  const locked_at =
    lineup.locked_at ??
    (Object.keys(locks).length
      ? Object.values(locks).sort()[0] ?? null
      : null);
  return { ...lineup, locks, locked_at };
}

export function segmentStartCounts(
  teamLineups: Record<string, GolfWeekLineup> | undefined,
  events: GolfEventMeta[],
  segmentId: string | null | undefined,
  excludeEventId?: string | null,
): Map<number, number> {
  const counts = new Map<number, number>();
  if (!segmentId || !teamLineups) return counts;
  for (const event of events) {
    if (event.segment_id !== segmentId) continue;
    if (excludeEventId && event.event_id === excludeEventId) continue;
    const lined = teamLineups[event.event_id];
    if (!lined) continue;
    for (const raw of lined.starters ?? []) {
      const pid = Number(raw);
      if (Number.isNaN(pid)) continue;
      counts.set(pid, (counts.get(pid) ?? 0) + 1);
    }
  }
  return counts;
}

/** True when the event's first tee time (or starts_at) has passed. */
export function eventDeadlinePassed(
  event: GolfEventMeta,
  now: Date = new Date(),
): boolean {
  const tees = Object.values(event.tee_times ?? {});
  const firstTee = tees.length
    ? tees.map((t) => new Date(t).getTime()).sort((a, b) => a - b)[0]
    : new Date(event.starts_at).getTime();
  if (firstTee == null || Number.isNaN(firstTee)) return false;
  return now.getTime() >= firstTee;
}

export function validateWeekLineup(
  lineup: {
    starters: number[];
    captain: number;
    alt1?: number | null;
    alt2?: number | null;
  },
  options: {
    rosterIds: Set<number>;
    golf: GolfSettings;
    teeTimes?: Record<string, string>;
    previous?: GolfWeekLineup | null;
    now?: Date;
    events?: GolfEventMeta[];
    teamLineups?: Record<string, GolfWeekLineup>;
    eventId?: string;
  },
): string | null {
  const {
    rosterIds,
    golf,
    teeTimes,
    previous,
    now = new Date(),
    events,
    teamLineups,
    eventId,
  } = options;
  const starters = lineup.starters.map(Number);
  if (starters.length !== (golf.roster.starters || GOLF_STARTERS)) {
    return `need exactly ${golf.roster.starters} starters`;
  }
  if (new Set(starters).size !== starters.length) {
    return "starters must be unique";
  }
  for (const pid of starters) {
    if (!rosterIds.has(pid)) return `starter ${pid} is not on the roster`;
  }
  if (!starters.includes(Number(lineup.captain))) {
    return "captain must be one of the starters";
  }
  const mode = golf.missed_cut.mode;
  if (mode === "off") {
    if (lineup.alt1 != null || lineup.alt2 != null) {
      return "alts are disabled for this league";
    }
  } else {
    if (lineup.alt1 != null) {
      const alt1 = Number(lineup.alt1);
      if (!rosterIds.has(alt1)) return `alt1 ${alt1} is not on the roster`;
      if (starters.includes(alt1)) return "alt1 cannot also be a starter";
    }
    if (mode === "alt1" && lineup.alt2 != null) {
      return "alt2 is not enabled (missed_cut.mode is alt1)";
    }
    if (mode === "alt1_2" && lineup.alt2 != null) {
      const alt2 = Number(lineup.alt2);
      if (!rosterIds.has(alt2)) return `alt2 ${alt2} is not on the roster`;
      if (starters.includes(alt2)) return "alt2 cannot also be a starter";
      if (lineup.alt1 != null && Number(lineup.alt1) === alt2) {
        return "alt1 and alt2 must differ";
      }
    }
  }

  if (previous && teeTimes) {
    const touched = new Set<number>();
    const prevStarters = previous.starters.map(Number);
    if (
      [...prevStarters].sort().join() !== [...starters].sort().join()
    ) {
      prevStarters.forEach((id) => touched.add(id));
      starters.forEach((id) => touched.add(id));
    }
    for (const key of ["captain", "alt1", "alt2"] as const) {
      const prev = previous[key] ?? null;
      const next = lineup[key] ?? null;
      if (prev !== next) {
        if (prev != null) touched.add(Number(prev));
        if (next != null) touched.add(Number(next));
      }
    }
    for (const pid of touched) {
      if (playerIsLocked(pid, teeTimes, now)) {
        return `player ${pid} is locked (tee time passed); cannot change`;
      }
    }
  }

  const maxStarts = golf.starts.max_per_segment;
  if (
    maxStarts &&
    maxStarts > 0 &&
    events?.length &&
    eventId &&
    teamLineups
  ) {
    const active = events.find((e) => e.event_id === eventId);
    const segment = active?.segment_id;
    if (segment) {
      const prior = segmentStartCounts(teamLineups, events, segment, eventId);
      for (const pid of starters) {
        const used = (prior.get(pid) ?? 0) + 1;
        if (used > maxStarts) {
          return `player ${pid} exceeds segment start cap (${used}/${maxStarts} in ${segment})`;
        }
      }
    }
  }
  return null;
}

export function buildLineupsPayload(
  teams: Team[],
  season: number,
  golf: GolfSettings,
  options?: { savedAt?: string; nowIso?: string },
): GolfLineupsFile {
  const savedAt = options?.savedAt ?? new Date().toISOString();
  const now = new Date(options?.nowIso ?? savedAt);
  const allIds: number[] = [];
  const seen = new Set<number>();
  for (const team of teams) {
    for (const player of team.roster ?? []) {
      if (player.id == null) continue;
      const id = Number(player.id);
      if (!seen.has(id)) {
        seen.add(id);
        allIds.push(id);
      }
    }
  }
  const events = fixtureEvents(season).map((event) => ({
    ...event,
    tee_times: teeTimesForRoster(allIds, event.starts_at),
  }));
  const teamMap: GolfLineupsFile["teams"] = {};
  for (const team of teams) {
    if (!team.roster?.length) continue;
    const base = {
      ...defaultLineupFromRoster(team.roster, golf, savedAt),
      source: "seed" as const,
    };
    teamMap[String(team.team_id)] = {};
    for (const event of events) {
      teamMap[String(team.team_id)][event.event_id] = applyLocks(
        { ...base },
        event.tee_times,
        now,
      );
    }
  }
  return {
    period_label: "event",
    current_event_id: events[0]?.event_id ?? null,
    events,
    teams: teamMap,
  };
}

export function golfSettingsFromLeagueSettings(
  settings: unknown,
): GolfSettings {
  return parseGolfSettings(settings) ?? DEFAULT_GOLF_SETTINGS;
}
