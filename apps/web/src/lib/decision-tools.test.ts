import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type {
  LeagueSnapshot,
  PlayerMapSnapshot,
  ProjectionSnapshot,
  Team,
} from "@/lib/data";
import {
  applyTradeRosters,
  defaultToolsPair,
  defaultToolsTeam,
  evaluateTrade,
  sumRosterProjections,
  teamStrengthRows,
  unrosteredProjectionRows,
  waiverBoardRows,
} from "@/lib/decision-tools";
import {
  attachPlayerProjections,
  indexPlayerMap,
  indexProjections,
} from "@/lib/projection-join";

function loadJson<T>(relative: string): T {
  return JSON.parse(
    readFileSync(path.resolve(__dirname, relative), "utf8"),
  ) as T;
}

function team(
  id: number,
  name: string,
  roster: Team["roster"],
): Team {
  return {
    team_id: id,
    name,
    abbrev: name.slice(0, 3),
    owners: ["Owner"],
    wins: 0,
    losses: 0,
    ties: 0,
    points_for: 0,
    points_against: 0,
    standing: id,
    division: "",
    roster,
  };
}

describe("decision-tools (roadmap 4.5)", () => {
  const map = loadJson<PlayerMapSnapshot>(
    "../../../../fixtures/sj/player_map/2025.json",
  );
  const snap = loadJson<ProjectionSnapshot>(
    "../../../../fixtures/sj/projections/ppr/2025.json",
  );
  const espnToGsis = indexPlayerMap(map);
  const byGsis = indexProjections(snap);

  const mahomes = {
    id: 3139477,
    name: "Patrick Mahomes",
    position: "QB",
    slot: "QB",
    pro_team: "KC",
    injury_status: null,
    total_points: 10,
    projected_total_points: null,
    avg_points: null,
  };
  const cmc = {
    id: 3117251,
    name: "Christian McCaffrey",
    position: "RB",
    slot: "RB",
    pro_team: "SF",
    injury_status: null,
    total_points: 10,
    projected_total_points: null,
    avg_points: null,
  };
  const jj = {
    id: 4262921,
    name: "Justin Jefferson",
    position: "WR",
    slot: "WR",
    pro_team: "MIN",
    injury_status: null,
    total_points: 10,
    projected_total_points: null,
    avg_points: null,
  };

  it("sums mapped roster projection quantiles", () => {
    const rows = attachPlayerProjections([mahomes, cmc], espnToGsis, byGsis);
    const totals = sumRosterProjections(rows);
    expect(totals.mapped).toBe(2);
    expect(totals.median).toBeCloseTo(
      (snap.players.find((p) => p.player_id === "00-0033873")?.median ?? 0) +
        (snap.players.find((p) => p.player_id === "00-0033280")?.median ?? 0),
    );
  });

  it("evaluates a one-for-one trade delta", () => {
    const a = team(1, "A", [mahomes, cmc]);
    const b = team(2, "B", [jj]);
    const result = evaluateTrade(a, b, [3117251], [4262921], espnToGsis, byGsis);
    // A gives CMC, gets JJ
    expect(result.sideA.after.mapped).toBe(2);
    expect(result.sideB.after.mapped).toBe(1);
    const { rosterA, rosterB } = applyTradeRosters(a, b, [3117251], [4262921]);
    expect(rosterA.map((p) => p.id)).toEqual([3139477, 4262921]);
    expect(rosterB.map((p) => p.id)).toEqual([3117251]);
    // CMC median 288, JJ 238 → A median drops, B rises
    expect(result.sideA.deltaMedian).toBeLessThan(0);
    expect(result.sideB.deltaMedian).toBeGreaterThan(0);
  });

  it("lists unrostered projection rows as waiver proxy", () => {
    const league = {
      league_id: "demo",
      espn_league_id: 1,
      sport: "football",
      format: "redraft",
      season: 2026,
      name: "Demo",
      team_count: 1,
      current_week: 1,
      teams: [team(1, "A", [mahomes])],
      players: [mahomes],
    } as LeagueSnapshot;
    const open = unrosteredProjectionRows(league, map, snap);
    const ids = open.map((p) => p.player_id);
    expect(ids).not.toContain("00-0033873");
    expect(ids).toContain("00-0033280");
    expect(ids).toContain("00-0036322");
    expect(open[0].vor! >= open[open.length - 1].vor!).toBe(true);
    const board = waiverBoardRows(league, map, snap);
    expect(board.source).toBe("proxy");
    expect(board.rows.map((r) => r.player_id)).toEqual(ids);
  });

  it("prefers ESPN free_agents when present", () => {
    const league = {
      league_id: "demo",
      espn_league_id: 1,
      sport: "football",
      format: "redraft",
      season: 2026,
      name: "Demo",
      team_count: 1,
      current_week: 1,
      teams: [team(1, "A", [mahomes])],
      players: [mahomes],
      free_agents: [
        {
          ...cmc,
          slot: "FA",
          status: "FREEAGENT",
          percent_owned: 22.5,
        },
        {
          id: 999001,
          name: "Unmapped Wire",
          position: "TE",
          slot: "FA",
          pro_team: "BUF",
          injury_status: "ACTIVE",
          status: "WAIVERS",
          percent_owned: 8.0,
          total_points: 10,
          projected_total_points: 12,
          avg_points: 1,
        },
      ],
    } as LeagueSnapshot;
    const board = waiverBoardRows(league, map, snap);
    expect(board.source).toBe("espn");
    expect(board.rows).toHaveLength(2);
    expect(board.rows[0].player_id).toBe("00-0033280");
    expect(board.rows[0].vor).toBeGreaterThan(0);
    expect(board.rows[0].percent_owned).toBe(22.5);
    expect(board.rows[1].player_name).toBe("Unmapped Wire");
    expect(board.rows[1].vor).toBeNull();
  });

  it("ranks team strength by median", () => {
    const league = {
      league_id: "demo",
      espn_league_id: 1,
      sport: "football",
      format: "redraft",
      season: 2026,
      name: "Demo",
      team_count: 2,
      current_week: 1,
      teams: [team(1, "Weak", [jj]), team(2, "Strong", [mahomes, cmc])],
      players: [],
    } as LeagueSnapshot;
    const rows = teamStrengthRows(league, espnToGsis, byGsis);
    expect(rows[0].name).toBe("Strong");
    expect(rows[0].totals.mapped).toBe(2);
  });

  describe("viewer-aware defaults (roadmap 7.1)", () => {
    const league = {
      league_id: "demo",
      espn_league_id: 1,
      sport: "football",
      format: "redraft",
      season: 2026,
      name: "Demo",
      team_count: 3,
      current_week: 1,
      teams: [team(1, "One", []), team(2, "Two", []), team(3, "Three", [])],
      players: [],
    } as LeagueSnapshot;

    it("opens the trade tool on the viewer's franchise", () => {
      expect(defaultToolsPair(league, 3)).toEqual({ a: 3, b: 1 });
      expect(defaultToolsPair(league, 1)).toEqual({ a: 1, b: 2 });
    });

    it("falls back to the first two teams when unlinked or not in this season", () => {
      expect(defaultToolsPair(league, undefined)).toEqual({ a: 1, b: 2 });
      expect(defaultToolsPair(league, 99)).toEqual({ a: 1, b: 2 });
    });

    it("needs two teams for a pair", () => {
      const solo = { ...league, teams: [team(1, "One", [])] } as LeagueSnapshot;
      expect(defaultToolsPair(solo, 1)).toBeNull();
    });

    it("opens single-team tools on the viewer's franchise", () => {
      expect(defaultToolsTeam(league, 3)).toBe(3);
      expect(defaultToolsTeam(league, undefined)).toBe(1);
      expect(defaultToolsTeam(league, 99)).toBe(1);
      expect(
        defaultToolsTeam({ ...league, teams: [] } as LeagueSnapshot, 1),
      ).toBeNull();
    });
  });
});
