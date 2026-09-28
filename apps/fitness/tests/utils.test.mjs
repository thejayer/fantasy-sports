import { describe, it, expect, vi } from "vitest";
import { loadUtilsContext } from "./helpers/loadAppContext.mjs";

describe("getDateKey", () => {
  it("formats a Date as YYYY-MM-DD", () => {
    const ctx = loadUtilsContext();
    expect(ctx.getDateKey(new Date(2026, 4, 16))).toBe("2026-05-16");
  });

  it("zero-pads single-digit months and days", () => {
    const ctx = loadUtilsContext();
    expect(ctx.getDateKey(new Date(2026, 0, 3))).toBe("2026-01-03");
  });
});

describe("getToday", () => {
  it("returns today as YYYY-MM-DD", () => {
    const ctx = loadUtilsContext();
    const today = new Date();
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(ctx.getToday()).toBe(expected);
  });
});

describe("daysAgo", () => {
  it("returns the date N days before today", () => {
    const ctx = loadUtilsContext();
    const expected = new Date();
    expected.setDate(expected.getDate() - 7);
    expect(ctx.daysAgo(7)).toBe(ctx.getDateKey(expected));
  });

  it("returns today when given 0", () => {
    const ctx = loadUtilsContext();
    expect(ctx.daysAgo(0)).toBe(ctx.getToday());
  });
});

describe("readStoredJson", () => {
  it("returns the parsed JSON value when present", () => {
    const ctx = loadUtilsContext({
      storage: { foo: JSON.stringify({ a: 1, b: [2, 3] }) },
    });
    expect(ctx.readStoredJson("foo", null)).toEqual({ a: 1, b: [2, 3] });
  });

  it("returns the fallback when the key is missing", () => {
    const ctx = loadUtilsContext();
    expect(ctx.readStoredJson("absent", "default")).toBe("default");
  });

  it("returns the fallback and warns when the stored value is corrupt", () => {
    const ctx = loadUtilsContext({ storage: { broken: "{not json" } });
    const warnSpy = vi.spyOn(ctx.console, "warn").mockImplementation(() => {});
    expect(ctx.readStoredJson("broken", { ok: true })).toEqual({ ok: true });
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });
});

describe("parseCsvRow", () => {
  it("splits a simple comma-separated row and trims cells", () => {
    const ctx = loadUtilsContext();
    expect(ctx.parseCsvRow("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("preserves commas inside quoted cells", () => {
    const ctx = loadUtilsContext();
    expect(ctx.parseCsvRow('one,"two, with comma",three')).toEqual([
      "one",
      "two, with comma",
      "three",
    ]);
  });

  it("treats a doubled quote inside a quoted cell as a literal quote", () => {
    const ctx = loadUtilsContext();
    expect(ctx.parseCsvRow('"He said ""hi""",next')).toEqual(['He said "hi"', "next"]);
  });

  it("returns a single empty cell for an empty input", () => {
    const ctx = loadUtilsContext();
    expect(ctx.parseCsvRow("")).toEqual([""]);
  });
});
