import { describe, expect, it } from "vitest";

import type { Team } from "@/lib/data";
import {
  formatMatchupScore,
  gamesForPeriod,
  outcomeTone,
  periodCount,
  playoffPeriods,
  playoffSeeds,
  projectedFirstRound,
  resolvePeriod,
  seasonSchedule,
} from "@/lib/matchups";

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

describe("matchup helpers", () => {
  const teams = [
    team({
      team_id: 1,
      name: "Alpha",
      standing: 1,
      schedule: [2, 1, 3],
      scores: [100, 0, 90],
      outcomes: ["W", "U", "L"],
    }),
    team({
      team_id: 2,
      name: "Bravo",
      standing: 2,
      schedule: [1, 3, 3],
      scores: [80, 110, 95],
      outcomes: ["L", "W", "W"],
    }),
    team({
      team_id: 3,
      name: "Charlie",
      standing: 3,
      schedule: [3, 2, 1],
      scores: [0, 70, 120],
      outcomes: ["U", "L", "W"],
    }),
  ];

  it("counts periods and resolves the active week", () => {
    expect(periodCount(teams)).toBe(3);
    expect(resolvePeriod(undefined, 2, 3)).toBe(2);
    expect(resolvePeriod(99, 2, 3)).toBe(3);
    expect(resolvePeriod(undefined, null, 3)).toBe(1);
    expect(resolvePeriod(undefined, null, 0)).toBe(1);
  });

  it("pairs matchups once and detects byes", () => {
    const week1 = gamesForPeriod(teams, 1);
    expect(week1.games).toHaveLength(1);
    expect(week1.byes).toHaveLength(1);
    expect(week1.byes[0].teamId).toBe(3);
    expect(week1.games[0].left.teamId).toBe(1);
    expect(week1.games[0].right.teamId).toBe(2);
    expect(week1.games[0].left.score).toBe(100);
    expect(week1.games[0].right.outcome).toBe("L");

    const week2 = gamesForPeriod(teams, 2);
    expect(week2.byes.map((b) => b.teamId)).toEqual([1]);
    expect(week2.games).toHaveLength(1);
    expect(week2.games[0].left.teamId).toBe(2);
  });

  it("builds a full season schedule", () => {
    const schedule = seasonSchedule(teams);
    expect(schedule).toHaveLength(3);
    expect(schedule[2].games[0].left.score).toBe(90);
  });

  it("derives playoff seeds and projected first round", () => {
    expect(playoffPeriods(2, 3)).toEqual([3]);
    expect(playoffPeriods(null, 3)).toEqual([]);
    const seeds = playoffSeeds(teams, 2);
    expect(seeds.map((t) => t.team_id)).toEqual([1, 2]);
    const projected = projectedFirstRound(seeds);
    expect(projected).toHaveLength(1);
    expect(projected[0].projected).toBe(true);
    expect(projected[0].left.teamId).toBe(1);
    expect(projected[0].right.teamId).toBe(2);
    expect(projected[0].left.score).toBeNull();
  });

  it("formats scores and outcome tones", () => {
    expect(formatMatchupScore(100)).toBe("100");
    expect(formatMatchupScore(98.7)).toBe("98.7");
    expect(formatMatchupScore(null)).toBe("—");
    expect(outcomeTone("W")).toBe("win");
    expect(outcomeTone("L")).toBe("loss");
    expect(outcomeTone("T")).toBe("tie");
    expect(outcomeTone("U")).toBe("open");
  });
});
