import { describe, expect, it } from "vitest";

import type { Team } from "@/lib/data";
import { buildGameLog, sparklineHeights } from "@/lib/game-log";

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

describe("buildGameLog (roadmap 7.4)", () => {
  // Team 1: beats 2, bye, loses to 3, then an unplayed week vs 2.
  const one = team({
    team_id: 1,
    name: "Alpha",
    schedule: [2, 1, 3, 2],
    scores: [100, 0, 80, null],
    outcomes: ["W", "U", "L", "U"],
  });
  const two = team({
    team_id: 2,
    name: "Bravo",
    schedule: [1, 3, 3, 1],
    scores: [90, 70, 60, null],
    outcomes: ["L", "L", "L", "U"],
  });
  const three = team({
    team_id: 3,
    name: "Charlie",
    schedule: [3, 2, 1, 3],
    scores: [0, 95, 110, null],
    outcomes: ["U", "W", "W", "U"],
  });
  const all = [one, two, three];

  it("pairs each period with the opponent and both scores", () => {
    const log = buildGameLog(one, all);
    expect(log.rows).toHaveLength(4);
    expect(log.rows[0]).toMatchObject({
      period: 1,
      opponentId: 2,
      opponentName: "Bravo",
      score: 100,
      opponentScore: 90,
      outcome: "W",
      bye: false,
      upcoming: false,
    });
    expect(log.rows[2]).toMatchObject({
      opponentName: "Charlie",
      score: 80,
      opponentScore: 110,
      outcome: "L",
    });
  });

  it("marks a bye (opponent id equals self) and carries no opponent score", () => {
    const log = buildGameLog(one, all);
    expect(log.rows[1]).toMatchObject({
      bye: true,
      opponentId: null,
      opponentName: null,
      opponentScore: null,
    });
  });

  it("treats a period with no score and no outcome as upcoming", () => {
    const log = buildGameLog(one, all);
    expect(log.rows[3].upcoming).toBe(true);
    expect(log.next?.period).toBe(4);
    expect(log.next?.opponentName).toBe("Bravo");
    expect(log.played.map((row) => row.period)).toEqual([1, 3]);
  });

  it("summarises high, low, and average over scored periods only", () => {
    const log = buildGameLog(one, all);
    expect(log.high?.score).toBe(100);
    expect(log.low?.score).toBe(80);
    // The bye scores 0 and the unplayed week is null; neither is an average.
    expect(log.averageScore).toBeCloseTo(90);
  });

  it("returns an empty log when the snapshot has no schedule", () => {
    const log = buildGameLog(team({ team_id: 9, name: "Empty" }), all);
    expect(log.rows).toEqual([]);
    expect(log.next).toBeNull();
    expect(log.averageScore).toBeNull();
  });

  it("keeps an unknown opponent id from inventing a name", () => {
    const orphan = team({
      team_id: 4,
      name: "Delta",
      schedule: [77],
      scores: [50],
      outcomes: ["W"],
    });
    const log = buildGameLog(orphan, [orphan]);
    expect(log.rows[0].opponentId).toBe(77);
    expect(log.rows[0].opponentName).toBeNull();
  });
});

describe("sparklineHeights", () => {
  it("normalises against the team's own range", () => {
    const t = team({
      team_id: 1,
      name: "Alpha",
      schedule: [2, 2, 2],
      scores: [80, 100, 90],
      outcomes: ["L", "W", "W"],
    });
    const bars = sparklineHeights(buildGameLog(t, [t]).rows);
    expect(bars.map((b) => b.period)).toEqual([1, 2, 3]);
    expect(bars[0].height).toBeCloseTo(0.12);
    expect(bars[1].height).toBeCloseTo(1);
    expect(bars[2].height).toBeGreaterThan(bars[0].height);
    expect(bars[2].height).toBeLessThan(bars[1].height);
  });

  it("renders a flat season at full height rather than at zero", () => {
    const t = team({
      team_id: 1,
      name: "Flat",
      schedule: [2, 2],
      scores: [90, 90],
      outcomes: ["W", "W"],
    });
    const bars = sparklineHeights(buildGameLog(t, [t]).rows);
    expect(bars.every((bar) => bar.height === 1)).toBe(true);
  });

  it("skips byes and unplayed periods", () => {
    const t = team({
      team_id: 1,
      name: "Alpha",
      schedule: [1, 2, 2],
      scores: [0, 90, null],
      outcomes: ["U", "W", "U"],
    });
    const bars = sparklineHeights(buildGameLog(t, [t]).rows);
    expect(bars.map((b) => b.period)).toEqual([2]);
  });
});
