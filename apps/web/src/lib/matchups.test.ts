import { describe, expect, it } from "vitest";

import type { Team } from "@/lib/data";
import {
  formatMatchupScore,
  gamesForPeriod,
  isViewerGame,
  outcomeTone,
  periodCount,
  playoffPeriods,
  playoffSeeds,
  projectedFirstRound,
  promoteViewerGame,
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

  describe("viewer promotion (roadmap 7.1)", () => {
    const week3 = gamesForPeriod(teams, 3);

    it("detects the viewer's game on either side", () => {
      const game = week3.games[0];
      expect(isViewerGame(game, game.left.teamId)).toBe(true);
      expect(isViewerGame(game, game.right.teamId)).toBe(true);
      expect(isViewerGame(game, 999)).toBe(false);
      expect(isViewerGame(game, undefined)).toBe(false);
    });

    it("moves the viewer's game first and puts them on the left", () => {
      const four = [
        team({ team_id: 1, name: "Alpha", schedule: [2], scores: [100] }),
        team({ team_id: 2, name: "Bravo", schedule: [1], scores: [90] }),
        team({ team_id: 3, name: "Charlie", schedule: [4], scores: [80] }),
        team({ team_id: 4, name: "Delta", schedule: [3], scores: [70] }),
      ];
      const games = gamesForPeriod(four, 1).games;
      // Default order is by left team_id, and team 4 sits on the right.
      expect(games.map((g) => [g.left.teamId, g.right.teamId])).toEqual([
        [1, 2],
        [3, 4],
      ]);

      const promoted = promoteViewerGame(games, 4);
      expect(promoted.map((g) => [g.left.teamId, g.right.teamId])).toEqual([
        [4, 3],
        [1, 2],
      ]);
      // Flipping sides must carry the score with the team, not the slot.
      expect(promoted[0].left.score).toBe(70);
    });

    it("returns the list untouched for an unlinked viewer", () => {
      expect(promoteViewerGame(week3.games, undefined)).toBe(week3.games);
      expect(promoteViewerGame(week3.games, null)).toBe(week3.games);
    });

    it("leaves ordering alone when the viewer has no game that period", () => {
      const promoted = promoteViewerGame(week3.games, 999);
      expect(promoted.map((g) => g.left.teamId)).toEqual(
        week3.games.map((g) => g.left.teamId),
      );
    });
  });
});
