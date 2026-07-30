import { describe, expect, it } from "vitest";

import type { LeagueSnapshot, Player, Team } from "@/lib/data";
import {
  buildLeagueCard,
  dashboardActions,
  golfLineupAction,
  relativeAge,
  shakyStarters,
  sortActions,
  syncedLabel,
} from "@/lib/member-home";
import { GOLF_FIXTURE_NOW } from "@/lib/golf-lineup";

function player(partial: Partial<Player> & Pick<Player, "id" | "name">): Player {
  return {
    position: "QB",
    slot: "QB",
    pro_team: "KC",
    injury_status: null,
    total_points: 0,
    projected_total_points: null,
    avg_points: null,
    ...partial,
  };
}

function team(partial: Partial<Team> & Pick<Team, "team_id" | "name">): Team {
  return {
    abbrev: null,
    owners: [],
    wins: 0,
    losses: 0,
    ties: 0,
    points_for: null,
    points_against: null,
    standing: null,
    division: "",
    roster: [],
    schedule: [],
    scores: [],
    outcomes: [],
    ...partial,
  };
}

function football(partial: Partial<LeagueSnapshot> = {}): LeagueSnapshot {
  return {
    league_id: "football-main",
    espn_league_id: 1,
    sport: "football",
    format: "redraft",
    season: 2026,
    name: "Main",
    team_count: 2,
    current_week: 2,
    period_label: "week",
    teams: [
      team({
        team_id: 1,
        name: "Alpha",
        wins: 1,
        losses: 1,
        standing: 1,
        points_for: 190,
        schedule: [2, 2, 2],
        scores: [100, 90, null],
        outcomes: ["W", "L", "U"],
      }),
      team({
        team_id: 2,
        name: "Bravo",
        wins: 1,
        losses: 1,
        standing: 2,
        schedule: [1, 1, 1],
        scores: [95, 110, null],
        outcomes: ["L", "W", "U"],
      }),
    ],
    players: [],
    ...partial,
  } as LeagueSnapshot;
}

describe("relativeAge / syncedLabel (roadmap 7.2)", () => {
  it("uses coarse units", () => {
    expect(relativeAge(30_000)).toBe("less than a minute");
    expect(relativeAge(5 * 60_000)).toBe("5 minutes");
    expect(relativeAge(60 * 60_000)).toBe("1 hour");
    expect(relativeAge(50 * 60 * 60_000)).toBe("2 days");
  });

  it("labels a sync time relative to now", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    expect(syncedLabel("2026-07-30T11:00:00Z", now)).toBe("1 hour ago");
    expect(syncedLabel(null, now)).toBeNull();
    expect(syncedLabel("not-a-date", now)).toBeNull();
  });

  it("does not report a future sync as negative", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    expect(syncedLabel("2026-07-30T12:05:00Z", now)).toBe("just now");
  });
});

describe("sortActions", () => {
  it("orders urgent before attention before info", () => {
    const sorted = sortActions([
      { id: "c", tone: "info", label: "c" },
      { id: "a", tone: "urgent", label: "a" },
      { id: "b", tone: "attention", label: "b" },
    ]);
    expect(sorted.map((a) => a.id)).toEqual(["a", "b", "c"]);
  });
});

describe("shakyStarters", () => {
  it("counts only unhealthy starters, not the bench or IR", () => {
    const t = team({
      team_id: 1,
      name: "Alpha",
      roster: [
        player({ id: 1, name: "Healthy Starter" }),
        player({ id: 2, name: "Hurt Starter", injury_status: "QUESTIONABLE" }),
        player({ id: 3, name: "Hurt Bench", slot: "BE", injury_status: "OUT" }),
        player({ id: 4, name: "On IR", slot: "IR", injury_status: "OUT" }),
      ],
    });
    expect(shakyStarters(t)).toEqual(["Hurt Starter"]);
  });

  it("ignores players with no slot at all", () => {
    const t = team({
      team_id: 1,
      name: "Alpha",
      roster: [player({ id: 1, name: "Slotless", slot: null, injury_status: "OUT" })],
    });
    expect(shakyStarters(t)).toEqual([]);
  });
});

describe("buildLeagueCard", () => {
  const now = new Date("2026-07-30T12:00:00Z");

  it("summarises the viewer's team and current matchup", () => {
    const card = buildLeagueCard(football(), 1, { now });
    expect(card.team).toMatchObject({
      teamId: 1,
      record: "1-1",
      standing: 1,
      teamCount: 2,
    });
    // current_week is 2, and week 2 was a loss to Bravo.
    expect(card.matchup).toMatchObject({
      period: 2,
      opponentName: "Bravo",
      score: 90,
      opponentScore: 110,
      outcome: "L",
      decided: true,
      bye: false,
    });
    expect(card.next?.period).toBe(3);
  });

  it("prompts to link a franchise when the member has none here", () => {
    const card = buildLeagueCard(football(), undefined, { now });
    expect(card.team).toBeNull();
    expect(card.matchup).toBeNull();
    expect(card.actions.map((a) => a.id)).toContain("link-football-main");
  });

  it("reports a bye rather than inventing an opponent", () => {
    const league = football({
      current_week: 1,
      teams: [
        team({
          team_id: 1,
          name: "Alpha",
          schedule: [1],
          scores: [0],
          outcomes: ["U"],
        }),
      ],
      team_count: 1,
    });
    expect(buildLeagueCard(league, 1, { now }).matchup).toMatchObject({
      bye: true,
      opponentName: null,
    });
  });

  it("marks an undecided matchup as in progress rather than a result", () => {
    const card = buildLeagueCard(football({ current_week: 3 }), 1, { now });
    expect(card.matchup?.period).toBe(3);
    expect(card.matchup?.decided).toBe(false);
  });

  it("raises injury urgency with the number of shaky starters", () => {
    const withOne = football();
    withOne.teams[0].roster = [
      player({ id: 1, name: "A", injury_status: "QUESTIONABLE" }),
    ];
    expect(
      buildLeagueCard(withOne, 1, { now }).actions.find((a) =>
        a.id.startsWith("injuries-"),
      )?.tone,
    ).toBe("attention");

    const withThree = football();
    withThree.teams[0].roster = [
      player({ id: 1, name: "A", injury_status: "OUT" }),
      player({ id: 2, name: "B", slot: "RB", injury_status: "OUT" }),
      player({ id: 3, name: "C", slot: "WR", injury_status: "DOUBTFUL" }),
    ];
    expect(
      buildLeagueCard(withThree, 1, { now }).actions.find((a) =>
        a.id.startsWith("injuries-"),
      )?.tone,
    ).toBe("urgent");
  });

  it("flags a stale snapshot", () => {
    const card = buildLeagueCard(
      football({ synced_at: "2026-07-29T12:00:00Z" }),
      1,
      { now },
    );
    const stale = card.actions.find((a) => a.id.startsWith("stale-"));
    expect(stale?.label).toContain("1 day ago");
  });

  it("does not flag a fresh snapshot", () => {
    const card = buildLeagueCard(
      football({ synced_at: "2026-07-30T11:30:00Z" }),
      1,
      { now },
    );
    expect(card.actions.some((a) => a.id.startsWith("stale-"))).toBe(false);
  });
});

describe("golfLineupAction", () => {
  const roster = [
    player({ id: 101, name: "G1", slot: "GS", position: "G" }),
    player({ id: 102, name: "G2", slot: "GS", position: "G" }),
  ];
  const golfTeam = team({ team_id: 2, name: "Pin High", roster });

  function golfLeague(
    lineups: LeagueSnapshot["lineups"],
    syncedAt = "2026-07-27T00:00:00Z",
  ): LeagueSnapshot {
    return {
      league_id: "golf-main",
      espn_league_id: null,
      sport: "golf",
      format: "h2h",
      season: 2026,
      name: "Golf",
      team_count: 1,
      current_week: 1,
      period_label: "event",
      synced_at: syncedAt,
      teams: [golfTeam],
      players: [],
      lineups,
    } as LeagueSnapshot;
  }

  it("is urgent when no lineup is saved for the current event", () => {
    const action = golfLineupAction(
      golfLeague({
        current_event_id: "2026-players",
        events: [
          {
            event_id: "2026-players",
            name: "THE PLAYERS",
            week: 1,
            starts_at: "2026-03-12T12:00:00+00:00",
            multiplier_tier: "signature",
          },
        ],
        teams: {},
      }),
      golfTeam,
    )!;
    expect(action.tone).toBe("urgent");
    expect(action.label).toContain("Set your lineup");
  });

  it("reports a locked lineup once a tee time has passed", () => {
    // GOLF_FIXTURE_NOW is after this tee time, and the fixture synced_at opts
    // into that deterministic clock.
    expect(new Date(GOLF_FIXTURE_NOW).getTime()).toBeGreaterThan(
      new Date("2026-03-12T12:00:00+00:00").getTime(),
    );
    const action = golfLineupAction(
      golfLeague({
        current_event_id: "2026-players",
        events: [
          {
            event_id: "2026-players",
            name: "THE PLAYERS",
            week: 1,
            starts_at: "2026-03-12T12:00:00+00:00",
            multiplier_tier: "signature",
            tee_times: { "101": "2026-03-12T12:00:00+00:00" },
          },
        ],
        teams: {
          "2": {
            "2026-players": {
              starters: [101, 102],
              captain: 101,
              saved_at: "2026-03-10T00:00:00Z",
            },
          },
        },
      }),
      golfTeam,
    )!;
    expect(action.label).toContain("locked");
  });

  it("says the lineup is still editable before any tee time", () => {
    const action = golfLineupAction(
      golfLeague({
        current_event_id: "2026-masters",
        events: [
          {
            event_id: "2026-masters",
            name: "Masters",
            week: 2,
            starts_at: "2026-04-09T12:00:00+00:00",
            multiplier_tier: "major",
            tee_times: { "101": "2026-04-09T12:00:00+00:00" },
          },
        ],
        teams: {
          "2": {
            "2026-masters": {
              starters: [101, 102],
              captain: 101,
              saved_at: "2026-03-10T00:00:00Z",
            },
          },
        },
      }),
      golfTeam,
    )!;
    expect(action.tone).toBe("info");
    expect(action.label).toContain("still editable");
  });

  it("is null when the snapshot has no current event", () => {
    expect(
      golfLineupAction(
        golfLeague({ current_event_id: null, events: [], teams: {} }),
        golfTeam,
      ),
    ).toBeNull();
    expect(golfLineupAction(golfLeague(undefined), golfTeam)).toBeNull();
  });
});

describe("dashboardActions", () => {
  it("hoists only actionable items and names the league", () => {
    const cards = [
      buildLeagueCard(football(), undefined),
      buildLeagueCard(
        football({ league_id: "other", name: "Other", synced_at: "2020-01-01T00:00:00Z" }),
        1,
      ),
    ];
    const todo = dashboardActions(cards);
    // The link prompt is actionable; the stale-sync note is informational.
    expect(todo.map((a) => a.id)).toEqual(["link-football-main"]);
    expect(todo[0].leagueName).toBe("Main");
  });
});
