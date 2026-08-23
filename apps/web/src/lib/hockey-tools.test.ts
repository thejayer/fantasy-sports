import { describe, expect, it } from "vitest";

import type { LeagueSnapshot, Player, Team } from "@/lib/data";
import {
  buildHockeyCategoryBoard,
  hockeyCategoriesForLeague,
  parseHockeyToolsView,
  rosterHasHockeyStats,
  sumHockeySeasonStats,
} from "@/lib/hockey-tools";

function player(partial: Partial<Player>): Player {
  return {
    id: 1,
    name: "P",
    position: "C",
    slot: "C",
    pro_team: "BOS",
    injury_status: null,
    status: "ACTIVE",
    total_points: 10,
    projected_total_points: null,
    avg_points: null,
    season_stats: { G: 10, A: 12 },
    ...partial,
  };
}

function team(partial: Partial<Team>): Team {
  return {
    team_id: 1,
    name: "Five Hole",
    abbrev: "FH",
    owners: [],
    wins: 1,
    losses: 0,
    ties: 0,
    win_pct: 1,
    points_for: 40,
    points_against: 30,
    standing: 1,
    schedule: [],
    scores: [],
    outcomes: [],
    roster: [player({})],
    ...partial,
  };
}

function league(partial: Partial<LeagueSnapshot> = {}): LeagueSnapshot {
  return {
    league_id: "hockey-main",
    espn_league_id: 0,
    sport: "hockey",
    format: "redraft",
    season: 2025,
    name: "Strictly Jayers Hockey",
    scoring_type: "H2H_POINTS",
    team_count: 1,
    current_week: 12,
    period_label: "week",
    settings: {
      scoring_type: "H2H_POINTS",
      scoring_format: [
        { id: 13, abbr: "G", label: "Goals", points: 3 },
        { id: 14, abbr: "A", label: "Assists", points: 2 },
      ],
    },
    teams: [team({})],
    players: [],
    ...partial,
  };
}

describe("hockey tools", () => {
  it("parses the category view and defaults home", () => {
    expect(parseHockeyToolsView("categories")).toBe("categories");
    expect(parseHockeyToolsView("nope")).toBe("home");
  });

  it("reads official hockey categories from settings", () => {
    const cats = hockeyCategoriesForLeague(league());
    expect(cats.map((c) => c.id)).toEqual(["G", "A"]);
  });

  it("builds a category board from roster season_stats", () => {
    const board = buildHockeyCategoryBoard(league());
    expect(board).toBeTruthy();
    expect(board!.rows[0]?.cells.G?.value).toBe(10);
    expect(rosterHasHockeyStats(league())).toBe(true);
  });

  it("returns null when no season_stats exist", () => {
    const empty = league({
      teams: [team({ roster: [player({ season_stats: undefined })] })],
    });
    expect(rosterHasHockeyStats(empty)).toBe(false);
    expect(buildHockeyCategoryBoard(empty)).toBeNull();
    expect(sumHockeySeasonStats(empty.teams[0]!)).toEqual({});
  });
});
