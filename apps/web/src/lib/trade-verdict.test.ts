import { describe, expect, it } from "vitest";

import type { TradeSideDelta } from "@/lib/decision-tools";
import { emptyRosterTotals } from "@/lib/decision-tools";
import { tradeVerdict } from "@/lib/trade-verdict";

function side(
  deltaMedian: number,
  deltaVor: number,
  floorDelta = 0,
  ceilDelta = 0,
): TradeSideDelta {
  const before = emptyRosterTotals(5);
  const after = {
    ...before,
    median: before.median + deltaMedian,
    vor: before.vor + deltaVor,
    floor: before.floor + floorDelta,
    ceiling: before.ceiling + ceilDelta,
  };
  return { before, after, deltaMedian, deltaVor };
}

describe("tradeVerdict (roadmap 7.8)", () => {
  it("states which side gains on median", () => {
    const v = tradeVerdict(
      side(12, 8, 4, 20),
      side(-5, -3, -2, -8),
      "Alpha",
      "Beta",
    );
    expect(v.favors).toBe("a");
    expect(v.headline).toMatch(/Favors Alpha/);
    expect(v.uncertainty).toMatch(/Floor\/ceiling/);
  });

  it("calls a wash when the edge is under a point", () => {
    const v = tradeVerdict(side(0.4, 0.2), side(0.1, 0), "A", "B");
    expect(v.favors).toBe("even");
    expect(v.headline).toMatch(/even/i);
  });
});
