import { describe, expect, it } from "vitest";

import type { LeagueSnapshot } from "@/lib/data";
import {
  buildGolfLineupReminders,
  formatGolfReminderMessage,
  golfReminderActionItem,
  REMINDER_WINDOWS_MS,
} from "@/lib/golf-lineup-reminder";
import type { HubMembersFile } from "@/lib/hub-members";

const members: HubMembersFile = {
  schema_version: 1,
  updated_at: "2026-01-01T00:00:00Z",
  members: [
    {
      email: "alice@example.com",
      role: "member",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      teams: [{ league_id: "golf-demo", team_id: 1, team_name: "Fairway" }],
    },
    {
      email: "bob@example.com",
      role: "member",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      teams: [{ league_id: "golf-demo", team_id: 2, team_name: "Pin High" }],
    },
  ],
};

function golfLeague(overrides: {
  nowIso?: string;
  team1Lineup?: boolean;
  team2Lineup?: boolean;
  teeOffsetHours?: number;
}): LeagueSnapshot {
  const teeOffset = (overrides.teeOffsetHours ?? 12) * 3600_000;
  const starts = "2026-03-12T12:00:00.000Z";
  const tee1 = new Date(new Date(starts).getTime() + teeOffset).toISOString();
  return {
    schema_version: 1,
    league_id: "golf-demo",
    name: "Demo Golf",
    season: 2026,
    sport: "golf",
    format: "h2h",
    scoring: "counting",
    synced_at: "2026-03-01T00:00:00Z",
    teams: [
      {
        team_id: 1,
        name: "Fairway",
        abbrev: "FWY",
        owners: [],
        wins: 0,
        losses: 0,
        ties: 0,
        points_for: 0,
        points_against: 0,
        standing: 1,
        division: "",
        roster: [
          {
            id: 101,
            name: "Scheffler",
            position: "G",
            slot: "BE",
            pro_team: null,
            injury_status: null,
            total_points: null,
            projected_total_points: null,
            avg_points: null,
          },
        ],
      },
      {
        team_id: 2,
        name: "Pin High",
        abbrev: "PIN",
        owners: [],
        wins: 0,
        losses: 0,
        ties: 0,
        points_for: 0,
        points_against: 0,
        standing: 2,
        division: "",
        roster: [
          {
            id: 201,
            name: "McIlroy",
            position: "G",
            slot: "BE",
            pro_team: null,
            injury_status: null,
            total_points: null,
            projected_total_points: null,
            avg_points: null,
          },
        ],
      },
    ],
    lineups: {
      current_event_id: "2026-players",
      events: [
        {
          event_id: "2026-players",
          name: "THE PLAYERS Championship",
          week: 1,
          starts_at: starts,
          multiplier_tier: "signature",
          tee_times: {
            "101": tee1,
            "201": tee1,
          },
        },
      ],
      teams: {
        ...(overrides.team1Lineup
          ? {
              "1": {
                "2026-players": {
                  starters: [101, 101, 101, 101, 101],
                  captain: 101,
                  saved_at: "2026-03-11T00:00:00Z",
                },
              },
            }
          : {}),
        ...(overrides.team2Lineup
          ? {
              "2": {
                "2026-players": {
                  starters: [201, 201, 201, 201, 201],
                  captain: 201,
                  saved_at: "2026-03-11T00:00:00Z",
                },
              },
            }
          : {}),
      },
    },
  } as unknown as LeagueSnapshot;
}

describe("golf lineup reminders (roadmap 7.7)", () => {
  it("builds reminders inside the 24h window for unset lineups", () => {
    const league = golfLeague({ teeOffsetHours: 0 });
    // 12h before event start / tee
    const now = new Date("2026-03-12T00:00:00.000Z");
    const batch = buildGolfLineupReminders(league, members, { now });
    expect(batch).not.toBeNull();
    expect(batch!.reminders).toHaveLength(2);
    expect(batch!.windowMs).toBe(REMINDER_WINDOWS_MS[0]); // 24h
    expect(batch!.reminders[0]?.memberEmail).toBe("alice@example.com");
    expect(formatGolfReminderMessage(batch!)).toMatch(/Lineup reminder/);
  });

  it("skips franchises that already set a lineup", () => {
    const league = golfLeague({ team1Lineup: true, teeOffsetHours: 0 });
    const now = new Date("2026-03-12T00:00:00.000Z");
    const batch = buildGolfLineupReminders(league, members, { now });
    expect(batch!.reminders.map((r) => r.teamId)).toEqual([2]);
  });

  it("skips when outside every window", () => {
    const league = golfLeague({ teeOffsetHours: 0 });
    const now = new Date("2026-03-10T00:00:00.000Z"); // > 24h out
    const batch = buildGolfLineupReminders(league, members, { now });
    expect(batch).toBeNull();
  });

  it("anyUnset admin poke ignores window bands", () => {
    const league = golfLeague({ teeOffsetHours: 0 });
    const now = new Date("2026-03-10T00:00:00.000Z");
    const batch = buildGolfLineupReminders(league, members, {
      now,
      anyUnset: true,
    });
    expect(batch!.reminders).toHaveLength(2);
    expect(batch!.windowMs).toBe(0);
  });

  it("member-home action uses the timed window copy", () => {
    const league = golfLeague({ teeOffsetHours: 0 });
    const now = new Date("2026-03-12T00:00:00.000Z");
    const item = golfReminderActionItem(league, 1, { now });
    expect(item?.tone).toBe("urgent");
    expect(item?.label).toMatch(/first tee within/i);
  });
});
