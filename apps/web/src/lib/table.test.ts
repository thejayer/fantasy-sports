import { describe, expect, it } from "vitest";

import {
  compareSortValues,
  normalizeSearch,
  paginateRows,
  toggleSortState,
  uniqueSorted,
} from "@/lib/table";

describe("table helpers", () => {
  it("normalizes search text", () => {
    expect(normalizeSearch("  Patrick  ")).toBe("patrick");
  });

  it("compares sort values with nulls last in the active direction", () => {
    expect(compareSortValues(1, 2, "asc")).toBeLessThan(0);
    expect(compareSortValues(1, 2, "desc")).toBeGreaterThan(0);
    expect(compareSortValues(null, 1, "desc")).toBeLessThan(0);
    expect(compareSortValues("alpha", "beta", "asc")).toBeLessThan(0);
  });

  it("toggles sort state through default → opposite → clear", () => {
    const first = toggleSortState(null, "fpts", { defaultDirection: "desc" });
    expect(first).toEqual({ columnId: "fpts", direction: "desc" });
    const second = toggleSortState(first, "fpts", { defaultDirection: "desc" });
    expect(second).toEqual({ columnId: "fpts", direction: "asc" });
    expect(toggleSortState(second, "fpts", { defaultDirection: "desc" })).toBeNull();
  });

  it("paginates and clamps out-of-range pages", () => {
    const rows = Array.from({ length: 30 }, (_, index) => index);
    const first = paginateRows(rows, 1, 25);
    expect(first.pageRows).toHaveLength(25);
    expect(first.pageCount).toBe(2);
    const clamped = paginateRows(rows, 99, 25);
    expect(clamped.safePage).toBe(2);
    expect(clamped.pageRows).toEqual([25, 26, 27, 28, 29]);
  });

  it("collects unique sorted filter values", () => {
    expect(uniqueSorted(["WR", null, "QB", "WR", undefined, "RB"])).toEqual([
      "QB",
      "RB",
      "WR",
    ]);
  });
});
