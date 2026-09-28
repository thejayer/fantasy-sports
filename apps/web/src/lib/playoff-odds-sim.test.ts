import { describe, expect, it } from "vitest";

import type { LeagueSnapshot, Team } from "@/lib/data";
import {
  applyRosterTrade,
  greedyLineupPoints,
  simulatePlayoffOdds,
  tradePlayoffDelta,
  undecidedMatchups,
  type PlayoffOddsSamples,
} from "@/lib/playoff-odds-sim";

function team(
  id: number,
  opts: Partial<Team> & {
    outcomes: string[];
    schedule: number[];
    roster: Team["roster"];
  },
): Team {
  return {
    team_id: id,
    name: `Team ${id}`,
    abbrev: `T${id}`,
    owners: [],
    wins: opts.wins ?? 0,
    losses: opts.losses ?? 0,
    ties: opts.ties ?? 0,
    points_for: opts.points_for ?? 0,
    points_against: 0,
    standing: opts.standing ?? id,
    division: "",
    schedule: opts.schedule,
    outcomes: opts.outcomes,
    scores: opts.scores,
    roster: opts.roster,
  };
}

const miniLeague = {
  schema_version: 1,
  league_id: "mini",
  name: "Mini",
  season: 2026,
  sport: "football",
  format: "redraft",
  scoring: "ppr",
  synced_at: "2026-01-01T00:00:00Z",
  settings: {
    reg_season_count: 4,
    playoff_team_count: 2,
    position_slot_counts: { QB: 1, RB: 1, WR: 1, TE: 0, FLEX: 0 },
  },
  teams: [
    team(1, {
      wins: 2,
      losses: 1,
      standing: 1,
      points_for: 300,
      schedule: [2, 2, 2, 2],
      outcomes: ["W", "L", "U", "U"],
      scores: [100, 80, null, null],
      roster: [
        { id: "e1", name: "A", position: "QB", slot: "QB", pro_team: "KC", injury_status: null, total_points: null, projected_total_points: null, avg_points: null },
        { id: "e2", name: "B", position: "RB", slot: "RB", pro_team: "SF", injury_status: null, total_points: null, projected_total_points: null, avg_points: null },
        { id: "e3", name: "C", position: "WR", slot: "WR", pro_team: "MIA", injury_status: null, total_points: null, projected_total_points: null, avg_points: null },
      ],
    }),
    team(2, {
      wins: 1,
      losses: 2,
      standing: 2,
      points_for: 280,
      schedule: [1, 1, 1, 1],
      outcomes: ["L", "W", "U", "U"],
      scores: [90, 90, null, null],
      roster: [
        { id: "e4", name: "D", position: "QB", slot: "QB", pro_team: "BUF", injury_status: null, total_points: null, projected_total_points: null, avg_points: null },
        { id: "e5", name: "E", position: "RB", slot: "RB", pro_team: "DAL", injury_status: null, total_points: null, projected_total_points: null, avg_points: null },
        { id: "e6", name: "F", position: "WR", slot: "WR", pro_team: "PHI", injury_status: null, total_points: null, projected_total_points: null, avg_points: null },
      ],
    }),
    team(3, {
      wins: 0,
      losses: 0,
      standing: 3,
      points_for: 100,
      schedule: [3, 3, 3, 3],
      outcomes: ["U", "U", "U", "U"],
      scores: [null, null, null, null],
      roster: [],
    }),
  ],
} as unknown as LeagueSnapshot;

const samples: PlayoffOddsSamples = {
  schema_version: 1,
  generated_at: "2026-01-01T00:00:00Z",
  league_id: "mini",
  season: 2026,
  scoring: "ppr",
  n_sims_default: 200,
  n_samples: 40,
  seed: 1,
  points_by_espn: {
    e1: Array(40).fill(30),
    e2: Array(40).fill(20),
    e3: Array(40).fill(15),
    e4: Array(40).fill(5),
    e5: Array(40).fill(5),
    e6: Array(40).fill(5),
  },
};

describe("playoff-odds-sim (roadmap 7.8 Δ)", () => {
  it("greedy lineup fills skill slots", () => {
    const pts = greedyLineupPoints(
      [
        { id: "a", position: "QB", points: 20 },
        { id: "b", position: "RB", points: 18 },
        { id: "c", position: "RB", points: 10 },
        { id: "d", position: "WR", points: 15 },
      ],
      { QB: 1, RB: 1, WR: 1, TE: 0, FLEX: 1 },
    );
    expect(pts).toBe(63);
  });

  it("undecided matchups dedupe remaining H2H", () => {
    expect(undecidedMatchups(miniLeague.teams, 4)).toEqual([
      [3, 1, 2],
      [4, 1, 2],
    ]);
  });

  it("stronger roster is favored in make-playoffs", () => {
    const res = simulatePlayoffOdds(miniLeague, samples, {
      nSims: 200,
      seed: 1,
    });
    const byId = new Map(res.teams.map((t) => [t.team_id, t]));
    expect(byId.get(1)?.make_playoffs).toBe(1);
    expect(byId.get(2)?.make_playoffs).toBe(1);
    expect(byId.get(3)?.make_playoffs).toBe(0);
    expect(byId.get(1)!.avg_wins).toBeGreaterThan(byId.get(2)!.avg_wins);
  });

  it("trading a star away drops team A make% when weeks remain", () => {
    // Tied records, one playoff slot, one remaining H2H — star swap flips favorite.
    const tied = {
      ...miniLeague,
      settings: { ...miniLeague.settings, playoff_team_count: 1 },
      teams: miniLeague.teams.map((t) => {
        if (t.team_id === 1) {
          return {
            ...t,
            wins: 2,
            losses: 2,
            points_for: 200,
            schedule: [2, 2, 2, 2],
            outcomes: ["W", "L", "W", "U"],
            scores: [100, 80, 90, null],
          };
        }
        if (t.team_id === 2) {
          return {
            ...t,
            wins: 2,
            losses: 2,
            points_for: 200,
            schedule: [1, 1, 1, 1],
            outcomes: ["L", "W", "L", "U"],
            scores: [90, 90, 85, null],
          };
        }
        return t;
      }),
    } as unknown as LeagueSnapshot;
    const lopsided: PlayoffOddsSamples = {
      ...samples,
      points_by_espn: {
        e1: Array(40).fill(50),
        e2: Array(40).fill(5),
        e3: Array(40).fill(5),
        e4: Array(40).fill(1),
        e5: Array(40).fill(1),
        e6: Array(40).fill(1),
      },
    };
    const before = simulatePlayoffOdds(tied, lopsided, { nSims: 200, seed: 3 });
    const byBefore = new Map(before.teams.map((t) => [t.team_id, t]));
    expect(byBefore.get(1)!.make_playoffs).toBeGreaterThan(0.8);

    const delta = tradePlayoffDelta(tied, lopsided, 1, 2, ["e1"], ["e4"], {
      nSims: 200,
      seed: 3,
    });
    expect(delta.available).toBe(true);
    expect(delta.deltaA).toBeLessThan(-0.3);
    expect(delta.deltaB).toBeGreaterThan(0.3);
  });

  it("applyRosterTrade swaps ESPN ids", () => {
    const next = applyRosterTrade(miniLeague, 1, 2, ["e1"], ["e4"]);
    const a = next.teams.find((t) => t.team_id === 1)!;
    const b = next.teams.find((t) => t.team_id === 2)!;
    expect(a.roster?.some((p) => String(p.id) === "e1")).toBe(false);
    expect(a.roster?.some((p) => String(p.id) === "e4")).toBe(true);
    expect(b.roster?.some((p) => String(p.id) === "e4")).toBe(false);
    expect(b.roster?.some((p) => String(p.id) === "e1")).toBe(true);
  });

  it("standings-locked seasons report unavailable Δ", () => {
    const locked = {
      ...miniLeague,
      teams: miniLeague.teams.map((t) => ({
        ...t,
        outcomes: ["W", "W", "W", "W"],
      })),
    } as unknown as LeagueSnapshot;
    const delta = tradePlayoffDelta(locked, samples, 1, 2, ["e1"], ["e4"]);
    expect(delta.available).toBe(false);
    expect(delta.reason).toMatch(/standings-locked/i);
  });
});
