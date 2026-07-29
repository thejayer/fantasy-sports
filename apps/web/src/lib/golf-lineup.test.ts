import { describe, expect, it } from "vitest";

import {
  applyLocks,
  buildLineupsPayload,
  defaultLineupFromRoster,
  GOLF_FIXTURE_NOW,
  playerIsLocked,
  validateWeekLineup,
} from "./golf-lineup";
import { DEFAULT_GOLF_SETTINGS } from "./golf";
import type { Player, Team } from "./data";

function fakeRoster(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `Golfer ${i + 1}`,
    position: "G",
    slot: i < 5 ? "GS" : "BE",
    pro_team: "USA",
    injury_status: null,
    total_points: 0,
    projected_total_points: null,
    avg_points: null,
  }));
}

describe("golf lineups", () => {
  it("defaults starters captain and alts from roster", () => {
    const lineup = defaultLineupFromRoster(
      fakeRoster(15),
      {
        ...DEFAULT_GOLF_SETTINGS,
        missed_cut: { mode: "alt1_2" },
      },
      GOLF_FIXTURE_NOW,
    );
    expect(lineup.starters).toEqual([1, 2, 3, 4, 5]);
    expect(lineup.captain).toBe(1);
    expect(lineup.alt1).toBe(6);
    expect(lineup.alt2).toBe(7);
  });

  it("locks players after fixture tee times", () => {
    const teeTimes = {
      "1": "2026-03-12T12:00:00+00:00",
      "9": "2026-03-12T18:00:00+00:00",
    };
    const now = new Date(GOLF_FIXTURE_NOW);
    expect(playerIsLocked(1, teeTimes, now)).toBe(true);
    expect(playerIsLocked(9, teeTimes, now)).toBe(false);
    const locked = applyLocks(
      {
        starters: [1, 2, 3, 4, 5],
        captain: 1,
        alt1: 6,
        saved_at: GOLF_FIXTURE_NOW,
        locks: {},
      },
      teeTimes,
      now,
    );
    expect(locked.locks?.["1"]).toBeTruthy();
  });

  it("rejects swaps of locked starters", () => {
    const err = validateWeekLineup(
      { starters: [1, 2, 3, 4, 7], captain: 1, alt1: 6 },
      {
        rosterIds: new Set([1, 2, 3, 4, 5, 6, 7]),
        golf: DEFAULT_GOLF_SETTINGS,
        teeTimes: {
          "1": "2026-03-12T12:00:00+00:00",
          "5": "2026-03-12T12:00:00+00:00",
          "7": "2026-03-12T18:00:00+00:00",
        },
        previous: {
          starters: [1, 2, 3, 4, 5],
          captain: 1,
          alt1: 6,
          saved_at: GOLF_FIXTURE_NOW,
        },
        now: new Date(GOLF_FIXTURE_NOW),
      },
    );
    expect(err).toMatch(/locked/i);
  });

  it("builds lineups payload for teams", () => {
    const teams = [
      {
        team_id: 1,
        name: "A",
        abbrev: "A",
        owners: [],
        wins: 0,
        losses: 0,
        ties: 0,
        points_for: 0,
        points_against: 0,
        standing: 1,
        division: "",
        roster: fakeRoster(15),
      },
    ] as Team[];
    const payload = buildLineupsPayload(teams, 2026, DEFAULT_GOLF_SETTINGS, {
      savedAt: GOLF_FIXTURE_NOW,
      nowIso: GOLF_FIXTURE_NOW,
    });
    expect(payload.events).toHaveLength(2);
    expect(payload.teams["1"]?.["2026-players"]?.starters).toHaveLength(5);
  });
});
