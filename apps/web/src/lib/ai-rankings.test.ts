import { describe, expect, it } from "vitest";

import {
  deltaLabel,
  formatWeekChip,
  isAiRankingsIndex,
  isAiRankingsSnapshot,
  modelLabel,
  resolveWeekLabel,
  vsApLabel,
} from "@/lib/ai-rankings";

describe("ai rankings helpers", () => {
  it("formats movers and AP deltas", () => {
    expect(deltaLabel(3)).toBe("▲3");
    expect(deltaLabel(-2)).toBe("▼2");
    expect(deltaLabel(0)).toBe("—");
    expect(deltaLabel(null)).toBe("—");
    expect(vsApLabel(-1)).toBe("-1 vs AP");
    expect(vsApLabel(2)).toBe("+2 vs AP");
    expect(vsApLabel(0)).toBe("even");
  });

  it("resolves the requested week or the latest index entry", () => {
    const index = { board: "cfb", latest: "2026-w07", weeks: ["2026-w06", "2026-w07"] };
    expect(resolveWeekLabel(index, "2026-w06")).toBe("2026-w06");
    expect(resolveWeekLabel(index, "nope")).toBe("2026-w07");
    expect(resolveWeekLabel(null, "2026-w07")).toBeNull();
    expect(resolveWeekLabel({ board: "cfb", weeks: [] }, "2026-w07")).toBeNull();
    expect(formatWeekChip("2026-w07")).toBe("2026 · W7");
    expect(formatWeekChip("2026-off")).toBe("2026 offseason");
    expect(modelLabel("xai/grok-4-fast")).toBe("xai/grok-4-fast");
    expect(modelLabel("fixture")).toBe("Fixture ballot");
  });

  it("accepts a stored snapshot shape", () => {
    expect(
      isAiRankingsSnapshot({
        schema_version: 1,
        board: "cfb",
        season: 2026,
        week: 7,
        week_label: "2026-w07",
        rankings: [{ rank: 1, name: "Ohio State" }],
      }),
    ).toBe(true);
    expect(isAiRankingsSnapshot({ week_label: "x" })).toBe(false);
    expect(isAiRankingsIndex({ board: "cfb", weeks: [] })).toBe(true);
  });
});
