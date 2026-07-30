import { describe, expect, it } from "vitest";

import {
  aggregateTeamCounting,
  baseballCategoriesForLeague,
  baseballFixtureNow,
  buildCategoryBoard,
  buildDailyLocksBoard,
  buildGamesPerTeamBoard,
  buildIpUsageBoard,
  buildTrailingBoard,
  buildTwoStartBoard,
  categoryValue,
  DEFAULT_BASEBALL_CATEGORIES,
  DEFAULT_MIN_WEEKLY_IP,
  DEFAULT_SEASON_IP_MAX,
  parseBaseballToolsView,
  parseTrailingWindow,
} from "@/lib/baseball-tools";
import type {
  LeagueSnapshot,
  Player,
  ProScheduleSnapshot,
  Team,
  WeekBoxScoreSnapshot,
} from "@/lib/data";

function team(
  id: number,
  name: string,
  batters: Array<Record<string, number>>,
  pitchers: Array<Record<string, number>>,
): Team {
  const roster = [
    ...batters.map(
      (s, i) =>
        ({
          id: id * 100 + i,
          name: `B${i}`,
          position: "OF",
          slot: "OF",
          role: "batter",
          season_stats: s,
        }) as Player,
    ),
    ...pitchers.map(
      (s, i) =>
        ({
          id: id * 100 + 50 + i,
          name: `P${i}`,
          position: "P",
          slot: "P",
          role: "pitcher",
          season_stats: s,
        }) as Player,
    ),
  ];
  return {
    team_id: id,
    name,
    abbrev: name.slice(0, 3),
    owners: [],
    wins: 0,
    losses: 0,
    ties: 0,
    points_for: 0,
    points_against: 0,
    standing: id,
    roster,
    schedule: [],
    scores: [],
    outcomes: [],
  } as unknown as Team;
}

describe("baseball-tools (roadmap 8.2)", () => {
  it("parses tools views", () => {
    expect(parseBaseballToolsView("categories")).toBe("categories");
    expect(parseBaseballToolsView("nope")).toBe("home");
    expect(parseTrailingWindow("30")).toBe("30");
    expect(parseTrailingWindow("nope")).toBe("7");
  });

  it("aggregates counting stats and recomputes rate cats", () => {
    const t = team(
      1,
      "A",
      [
        { AB: 100, H: 30, R: 20, HR: 5, RBI: 15, SB: 3 },
        { AB: 100, H: 20, R: 10, HR: 2, RBI: 8, SB: 1 },
      ],
      [{ W: 5, SV: 2, K: 40, IP: 50, ERA: 3.6, WHIP: 1.2, OUTS: 150 }],
    );
    const totals = aggregateTeamCounting(t);
    expect(totals.ab).toBe(200);
    expect(totals.h).toBe(50);
    expect(totals.r).toBe(30);
    expect(categoryValue(totals, DEFAULT_BASEBALL_CATEGORIES[4]!)).toBeCloseTo(
      0.25,
      5,
    );
    // ER = 3.6 * 50 / 9 = 20 → ERA = 20*9/50 = 3.6
    expect(categoryValue(totals, DEFAULT_BASEBALL_CATEGORIES[8]!)).toBeCloseTo(
      3.6,
      5,
    );
  });

  it("builds a category board with roto ranks", () => {
    const league = {
      league_id: "b",
      sport: "baseball",
      season: 2026,
      name: "Test",
      teams: [
        team(
          1,
          "Dogs",
          [{ AB: 200, H: 60, R: 40, HR: 12, RBI: 35, SB: 8 }],
          [{ W: 10, SV: 5, K: 80, IP: 60, ERA: 3.0, WHIP: 1.1, OUTS: 180 }],
        ),
        team(
          2,
          "Bandits",
          [{ AB: 200, H: 40, R: 20, HR: 4, RBI: 18, SB: 2 }],
          [{ W: 4, SV: 1, K: 40, IP: 60, ERA: 5.0, WHIP: 1.5, OUTS: 180 }],
        ),
      ],
    } as unknown as LeagueSnapshot;

    const board = buildCategoryBoard(league);
    expect(board.rows).toHaveLength(2);
    expect(board.rows[0]?.name).toBe("Dogs");
    expect(board.rows[0]?.rotoRank).toBe(1);
    expect(board.rows[0]?.cells.HR.value).toBe(12);
    expect(board.rows[1]?.cells.HR.rank).toBe(2);
    expect(board.disclaimer).toMatch(/Season-to-date/);
  });

  it("maps synced category settings onto supported category definitions", () => {
    const league = {
      settings: {
        categories: [
          { id: 20, abbr: "R", label: "Runs", points: null },
          { id: 5, abbr: "HR", label: "Home Runs", points: null },
          { id: 999, abbr: "NOPE", label: "Unsupported", points: null },
        ],
      },
    } as unknown as LeagueSnapshot;

    const categories = baseballCategoriesForLeague(league);
    expect(categories.map((cat) => cat.id)).toEqual(["R", "HR"]);
    expect(categories[0]?.label).toBe("Runs");
  });

  it("builds IP usage against the default season ceiling", () => {
    const league = {
      league_id: "b",
      sport: "baseball",
      season: 2026,
      name: "Test",
      settings: null,
      teams: [
        team(1, "Dogs", [], [
          { IP: 100, OUTS: 300, ERA: 4, WHIP: 1.3, W: 1, SV: 0, K: 10 },
          { IP: 50, OUTS: 150, ERA: 3, WHIP: 1.1, W: 1, SV: 0, K: 10 },
        ]),
      ],
    } as unknown as LeagueSnapshot;

    const board = buildIpUsageBoard(league);
    expect(board.seasonMax).toBe(DEFAULT_SEASON_IP_MAX);
    expect(board.seasonMaxSource).toBe("default");
    expect(board.teams[0]?.ip).toBeCloseTo(150, 5);
    expect(board.teams[0]?.remaining).toBeCloseTo(DEFAULT_SEASON_IP_MAX - 150, 5);
    expect(board.pitchers).toHaveLength(2);
    expect(board.disclaimer).toMatch(/period pitcher lines/i);
  });

  it("surfaces season GS caps and period IP floors when present", () => {
    const dogs = team(1, "Dogs", [], [
      { IP: 100, OUTS: 300, GS: 20, ERA: 4, WHIP: 1.3, W: 1, SV: 0, K: 10 },
    ]);
    const cats = team(2, "Cats", [], [
      { IP: 80, OUTS: 240, GS: 12, ERA: 3, WHIP: 1.1, W: 1, SV: 0, K: 10 },
    ]);
    const league = {
      league_id: "b",
      sport: "baseball",
      season: 2026,
      current_week: 24,
      settings: {
        season_ip_max: 1400,
        season_gs_max: 200,
        min_weekly_ip: 20,
      },
      teams: [dogs, cats],
    } as unknown as LeagueSnapshot;
    const weekBox = {
      schema_version: 1,
      league_id: "b",
      season: 2026,
      week: 24,
      sport: "baseball",
      matchups: [],
      pitcher_ip: [
        { player_id: 150, name: "P0", team_id: 1, outs: 45, ip: 15 },
        { player_id: 250, name: "P0", team_id: 2, outs: 66, ip: 22 },
      ],
    } as WeekBoxScoreSnapshot;

    const board = buildIpUsageBoard(league, weekBox);
    expect(board.seasonGsMax).toBe(200);
    expect(board.gsTeams[0]?.gs).toBe(20);
    expect(board.minWeeklyIp).toBe(20);
    expect(board.periodTeams.find((row) => row.teamId === 1)?.met).toBe(false);
    expect(board.periodTeams.find((row) => row.teamId === 2)?.met).toBe(true);
    expect(board.disclaimer).toMatch(/Period pitcher IP/);
  });

  it("defaults weekly IP floor when period lines exist without settings", () => {
    const league = {
      settings: {},
      teams: [team(1, "Dogs", [], [{ IP: 10, OUTS: 30, GS: 1 }])],
    } as unknown as LeagueSnapshot;
    const weekBox = {
      schema_version: 1,
      league_id: "b",
      season: 2026,
      sport: "baseball",
      week: 1,
      pitcher_ip: [{ player_id: 1, name: "A", team_id: 1, ip: 5 }],
      matchups: [],
    } as WeekBoxScoreSnapshot;
    const board = buildIpUsageBoard(league, weekBox);
    expect(board.minWeeklyIp).toBe(DEFAULT_MIN_WEEKLY_IP);
    expect(board.minWeeklyIpSource).toBe("default");
  });

  it("lists two-start pitchers from probable starters", () => {
    const dogs = team(1, "Dogs", [], [{ IP: 10, OUTS: 30 }]);
    dogs.roster[0] = {
      ...dogs.roster[0]!,
      id: 99,
      name: "Ace TwoStart",
      position: "SP",
      slot: "SP",
      role: "pitcher",
      pro_team: "BAL",
    };
    const league = {
      current_week: 24,
      settings: { matchup_periods: { "24": [24] } },
      teams: [dogs],
    } as unknown as LeagueSnapshot;
    const schedule = {
      league_id: "b",
      season: 2026,
      sport: "baseball",
      games: [
        {
          away_pro_team: "NYY",
          home_pro_team: "BAL",
          scoring_period_id: 24,
          start_time: "2026-07-27T17:05:00+00:00",
          probable_home: { id: 99, name: "Ace TwoStart" },
        },
        {
          away_pro_team: "BAL",
          home_pro_team: "BOS",
          scoring_period_id: 24,
          start_time: "2026-07-28T17:05:00+00:00",
          probable_away: { id: 99, name: "Ace TwoStart" },
        },
        {
          away_pro_team: "TB",
          home_pro_team: "TOR",
          scoring_period_id: 24,
          start_time: "2026-07-27T18:05:00+00:00",
          probable_home: { id: 7, name: "One Start" },
        },
      ],
    } as ProScheduleSnapshot;

    const board = buildTwoStartBoard(league, schedule);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0]?.name).toBe("Ace TwoStart");
    expect(board.rows[0]?.starts).toBe(2);
    expect(board.rows[0]?.fantasyTeamName).toBe("Dogs");
    expect(board.disclaimer).toMatch(/probable starters/i);
  });

  it("builds trailing boards from roster and free-agent split buckets", () => {
    const dogs = team(1, "Dogs", [{ R: 1 }], []);
    dogs.roster[0] = {
      ...dogs.roster[0]!,
      id: 101,
      name: "Roster Bat",
      pro_team: "bal",
      trailing_stats: { "7": { R: 4, HR: 2, RBI: 6, SB: 1 } },
    };
    const freePitcher = {
      id: 202,
      name: "Wire Arm",
      position: "SP",
      slot: "FA",
      role: "pitcher",
      pro_team: "SF",
      injury_status: null,
      total_points: null,
      projected_total_points: null,
      avg_points: null,
      trailing_stats: { "7": { K: 12, W: 1, QS: 1 } },
    } as Player;
    const league = {
      league_id: "b",
      sport: "baseball",
      season: 2026,
      name: "Test",
      teams: [dogs],
      free_agents: [freePitcher],
    } as unknown as LeagueSnapshot;

    const board = buildTrailingBoard(league, "7");
    expect(board.batters[0]?.name).toBe("Roster Bat");
    expect(board.batters[0]?.score).toBe(13);
    expect(board.pitchers[0]?.name).toBe("Wire Arm");
    expect(board.pitchers[0]?.fantasyTeamName).toBe("Free agent");
    expect(board.disclaimer).toMatch(/PR7/);
  });

  it("discloses season-bucket limitation when trailing splits are missing", () => {
    const league = {
      league_id: "b",
      sport: "baseball",
      season: 2026,
      name: "Test",
      teams: [team(1, "Dogs", [{ R: 10, HR: 2 }], [])],
      free_agents: [],
    } as unknown as LeagueSnapshot;

    const board = buildTrailingBoard(league, "15");
    expect(board.batters).toHaveLength(0);
    expect(board.pitchers).toHaveLength(0);
    expect(board.disclaimer).toMatch(/season bucket/i);
  });

  it("counts roster player-games for the current matchup period", () => {
    const dogs = team(1, "Dogs", [{ R: 1 }, { R: 1 }], []);
    dogs.roster[0] = { ...dogs.roster[0]!, pro_team: "bal" };
    dogs.roster[1] = { ...dogs.roster[1]!, pro_team: "SF" };
    const cats = team(2, "Cats", [{ R: 1 }], []);
    cats.roster[0] = { ...cats.roster[0]!, pro_team: "laa" };
    const league = {
      current_week: 24,
      settings: { matchup_periods: { "24": [24] } },
      teams: [dogs, cats],
    } as unknown as LeagueSnapshot;
    const schedule = {
      league_id: "b",
      season: 2026,
      sport: "baseball",
      games: [
        {
          away_pro_team: "BAL",
          home_pro_team: "SF",
          scoring_period_id: 24,
          start_time: "2026-07-27T17:05:00+00:00",
        },
        {
          away_pro_team: "PHI",
          home_pro_team: "LAA",
          scoring_period_id: 24,
          start_time: "2026-07-27T18:05:00+00:00",
        },
        {
          away_pro_team: "BAL",
          home_pro_team: "SF",
          scoring_period_id: 25,
          start_time: "2026-07-28T17:05:00+00:00",
        },
      ],
    } as ProScheduleSnapshot;

    const board = buildGamesPerTeamBoard(league, schedule);
    expect(board.scoringPeriods).toEqual([24]);
    expect(board.rows[0]?.name).toBe("Dogs");
    expect(board.rows[0]?.totalPlayerGames).toBe(2);
    expect(board.rows[1]?.totalPlayerGames).toBe(1);
  });

  it("joins today's pro games to rostered players for daily locks", () => {
    expect(baseballFixtureNow("2026-07-27T00:00:00+00:00").toISOString()).toBe(
      "2026-07-27T12:00:00.000Z",
    );
    const dogs = team(1, "Dogs", [{ R: 1 }], []);
    dogs.roster[0] = {
      ...dogs.roster[0]!,
      id: 101,
      name: "Roster Bat",
      slot: "OF",
      pro_team: "BAL",
    };
    const league = { teams: [dogs] } as unknown as LeagueSnapshot;
    const schedule = {
      league_id: "b",
      season: 2026,
      sport: "baseball",
      games: [
        {
          away_pro_team: "BAL",
          home_pro_team: "SF",
          scoring_period_id: 24,
          start_time: "2026-07-27T17:05:00+00:00",
        },
        {
          away_pro_team: "BAL",
          home_pro_team: "SF",
          scoring_period_id: 25,
          start_time: "2026-07-28T17:05:00+00:00",
        },
      ],
    } as ProScheduleSnapshot;

    const board = buildDailyLocksBoard(
      league,
      schedule,
      new Date("2026-07-27T12:00:00+00:00"),
    );
    expect(board.games).toHaveLength(1);
    expect(board.games[0]?.awayProTeam).toBe("BAL");
    expect(board.games[0]?.players[0]?.name).toBe("Roster Bat");
  });
});
