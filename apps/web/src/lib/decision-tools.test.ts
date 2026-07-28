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
  evaluateTrade,
  sumRosterProjections,
  teamStrengthRows,
  unrosteredProjectionRows,
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
});
