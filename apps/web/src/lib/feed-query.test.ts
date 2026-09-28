import { describe, expect, it } from "vitest";

import {
  compareFeedSortKey,
  inFeedDateRange,
  isoCreatedAtMs,
  parseFeedDayEnd,
  parseFeedDayStart,
  parseFeedSortDir,
  sortByFeedKey,
} from "@/lib/feed-query";

describe("feed-query", () => {
  it("defaults sort dir to descending", () => {
    expect(parseFeedSortDir(null)).toBe("desc");
    expect(parseFeedSortDir("desc")).toBe("desc");
    expect(parseFeedSortDir("asc")).toBe("asc");
    expect(parseFeedSortDir("nope")).toBe("desc");
  });

  it("parses inclusive UTC day bounds", () => {
    expect(parseFeedDayStart("2026-09-05")).toBe(Date.UTC(2026, 8, 5));
    expect(parseFeedDayEnd("2026-09-05")).toBe(
      Date.UTC(2026, 8, 5, 23, 59, 59, 999),
    );
    expect(parseFeedDayStart("bad")).toBeNull();
    expect(parseFeedDayEnd("")).toBeNull();
  });

  it("filters by date range", () => {
    const mid = Date.UTC(2026, 8, 5, 12);
    expect(inFeedDateRange(mid, Date.UTC(2026, 8, 5), Date.UTC(2026, 8, 5, 23, 59, 59, 999))).toBe(
      true,
    );
    expect(inFeedDateRange(mid, Date.UTC(2026, 8, 6), null)).toBe(false);
    expect(inFeedDateRange(mid, null, Date.UTC(2026, 8, 4))).toBe(false);
  });

  it("sorts newest-first by default and can reverse", () => {
    const rows = [
      { id: "a", t: 1 },
      { id: "b", t: 3 },
      { id: "c", t: 2 },
    ];
    expect(
      sortByFeedKey(
        rows,
        (r) => r.t,
        (r) => r.id,
        "desc",
      ).map((r) => r.id),
    ).toEqual(["b", "c", "a"]);
    expect(
      sortByFeedKey(
        rows,
        (r) => r.t,
        (r) => r.id,
        "asc",
      ).map((r) => r.id),
    ).toEqual(["a", "c", "b"]);
    expect(compareFeedSortKey(1, 2, "desc")).toBeGreaterThan(0);
  });

  it("parses ISO created_at", () => {
    expect(isoCreatedAtMs("2026-09-05T18:00:00.000Z")).toBe(
      Date.parse("2026-09-05T18:00:00.000Z"),
    );
    expect(isoCreatedAtMs("nope")).toBe(0);
  });
});
