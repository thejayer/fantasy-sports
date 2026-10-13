import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  addMinutes,
  parseInstant,
  startOfZonedDay,
  startOfZonedWeek,
  tzOffsetMs,
  zonedDateKey,
  zonedLocalToUtc,
  zonedParts,
} from "./timezone";

describe("timezone / DST", () => {
  it("parses Health Auto Export offsets", () => {
    const date = parseInstant("2026-10-05 06:00:00 -0500");
    expect(date?.toISOString()).toBe("2026-10-05T11:00:00.000Z");
  });

  it("buckets Chicago civil time, not UTC hour", () => {
    const utc = new Date("2026-10-05T11:00:00.000Z");
    const z = zonedParts(utc, "America/Chicago");
    expect(z.hour).toBe(6);
    expect(z.day).toBe(5);
    expect(zonedDateKey(utc, "America/Chicago")).toBe("2026-10-05");
  });

  it("starts the US week on Sunday in Chicago", () => {
    const saturday = new Date("2026-10-10T17:00:00.000Z");
    const start = startOfZonedWeek(saturday, "America/Chicago");
    expect(zonedDateKey(start, "America/Chicago")).toBe("2026-10-04");
    expect(zonedParts(start, "America/Chicago").weekday).toBe(0);
  });

  it("handles a workout that crosses midnight", () => {
    const start = zonedLocalToUtc("America/Chicago", 2026, 10, 10, 23, 15);
    const end = zonedLocalToUtc("America/Chicago", 2026, 10, 11, 0, 45);
    expect(zonedDateKey(start, "America/Chicago")).toBe("2026-10-10");
    expect(zonedDateKey(end, "America/Chicago")).toBe("2026-10-11");
    expect(end.getTime() - start.getTime()).toBe(90 * 60 * 1000);
  });

  it("keeps millisecond duration across the March 2026 spring-forward", () => {
    // 2026-03-08 02:00 CST → 03:00 CDT
    const before = zonedLocalToUtc("America/Chicago", 2026, 3, 8, 1, 30);
    const after = addMinutes(before, 60);
    const parts = zonedParts(after, "America/Chicago");
    expect(parts.hour).toBe(3);
    expect(after.getTime() - before.getTime()).toBe(60 * 60 * 1000);
  });

  it("does not double-count the November 2026 fall-back hour as extra duration", () => {
    const before = zonedLocalToUtc("America/Chicago", 2026, 11, 1, 0, 30);
    const later = addMinutes(before, 180);
    expect(later.getTime() - before.getTime()).toBe(180 * 60 * 1000);
    expect(zonedParts(later, "America/Chicago").hour).toBe(2);
  });

  it("walks calendar days across DST without skipping a date key", () => {
    const start = startOfZonedDay(
      zonedLocalToUtc("America/Chicago", 2026, 3, 7, 12, 0),
      "America/Chicago",
    );
    const next = addCalendarDays(start, 1, "America/Chicago");
    expect(zonedDateKey(next, "America/Chicago")).toBe("2026-03-08");
    const after = addCalendarDays(next, 1, "America/Chicago");
    expect(zonedDateKey(after, "America/Chicago")).toBe("2026-03-09");
  });

  it("computes a Chicago offset that flips at DST", () => {
    const cst = zonedLocalToUtc("America/Chicago", 2026, 1, 15, 12, 0);
    const cdt = zonedLocalToUtc("America/Chicago", 2026, 7, 15, 12, 0);
    expect(tzOffsetMs(cst, "America/Chicago")).toBe(-6 * 3600 * 1000);
    expect(tzOffsetMs(cdt, "America/Chicago")).toBe(-5 * 3600 * 1000);
  });
});
