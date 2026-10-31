import { describe, expect, it } from "vitest";

import { bestRank, statTiles } from "./profile-stats";

describe("profile stats", () => {
  it("picks the best rank across boards", () => {
    expect(bestRank({ win: 5, mult: 2, jackpots: null })).toEqual({ rank: 2, board: "best multiplier" });
    expect(bestRank({ win: null, mult: null, jackpots: null })).toBeNull();
    expect(bestRank(undefined)).toBeNull();
  });

  it("formats tiles and survives missing data", () => {
    const tiles = statTiles(
      { chips: 24967.4, streak: 1, fantasyChips: 10000, fantasyWins: 2, trophies: [{}, {}] },
      { spins: 1234, biggestWin: 75, bestMultiplier: 15, ranks: { win: 1, mult: 3, jackpots: null } },
    );
    const by = Object.fromEntries(tiles.map((t) => [t.id, t]));
    expect(by.chips?.value).toBe("24,967");
    expect(by.streak?.value).toBe("1 day");
    expect(by.spins?.value).toBe("1,234");
    expect(by.mult?.value).toBe("15x");
    expect(by.rank?.value).toBe("#1");
    expect(by.fantasy?.hint).toBe("2 matchup wins");
    expect(by.trophies?.value).toBe("2");

    const empty = Object.fromEntries(statTiles({}, {}).map((t) => [t.id, t]));
    expect(empty.chips?.value).toBe("0");
    expect(empty.rank?.value).toBe("–");
    expect(empty.mult?.value).toBe("–");
  });
});
