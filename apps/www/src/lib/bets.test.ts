import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { BetRow } from "./bets";
import {
  americanToDecimal,
  bettorKpis,
  classifyParlay,
  dollarPl,
  filterBets,
  inWindow,
  parseOdds,
  unitsPl,
  windowDate,
} from "./bets";

const SAMPLE = JSON.parse(
  readFileSync(
    path.resolve(__dirname, "../../fixtures/bets/sample40.json"),
    "utf8",
  ),
) as BetRow[];

describe("odds and money math", () => {
  it("parses American, decimal, and blank odds", () => {
    expect(parseOdds("+770").dec).toBe(8.7);
    expect(parseOdds("-110").dec).toBeCloseTo(americanToDecimal(-110) ?? 0);
    expect(parseOdds("not shown")).toEqual({ odds: null, dec: null });
    expect(parseOdds("", 10).dec).toBe(10);
    expect(parseOdds("1.91").dec).toBe(1.91);
  });

  it("computes dollar P/L only when a stake exists", () => {
    const win = { res: "W", stake: 100, dec: 2, odds: "+100", towin: null };
    expect(dollarPl(win)).toBe(100);
    expect(dollarPl({ ...win, res: "L" })).toBe(-100);
    expect(dollarPl({ ...win, res: "Push" })).toBe(0);
    expect(dollarPl({ ...win, res: "Pending" })).toBeNull();
    expect(
      dollarPl({ res: "W", stake: null, dec: 2, odds: "+100", towin: null }),
    ).toBeNull();
  });

  it("prices unit P/L on a win only when odds exist", () => {
    const win = { res: "W", units: 10, odds: "+100", dec: 2 };
    expect(unitsPl(win)).toBe(10);
    expect(unitsPl({ ...win, res: "L" })).toBe(-10);
    expect(unitsPl({ res: "W", units: 10, odds: "not shown", dec: null })).toBeNull();
  });
});

describe("record / ROI / windows / parlays", () => {
  it("excludes pending and unknown from the record and P/L", () => {
    const rows: BetRow[] = [
      baseBet({ res: "W", stake: 100, dec: 2, gd: "2026-09-10" }),
      baseBet({ res: "L", stake: 100, dec: 2, gd: "2026-09-10" }),
      baseBet({ res: "Push", stake: 50, dec: 2, gd: "2026-09-10" }),
      baseBet({ res: "Pending", stake: 200, dec: 2, gd: "2026-09-10" }),
      baseBet({ res: "Unknown", stake: 200, dec: 2, gd: "2026-09-10" }),
    ];
    const kpi = bettorKpis(rows, "Trent");
    expect(kpi.record).toBe("1-1-1");
    expect(kpi.winPct).toBe(0.5);
    expect(kpi.pl).toBe(0);
    expect(kpi.roi).toBe(0);
    expect(kpi.pending).toBe(1);
    expect(kpi.unknown).toBe(1);
    expect(kpi.bets).toBe(5);
  });

  it("windows use game date, then posted date", () => {
    expect(inWindow({ gd: "2026-08-27", posted: "2026-08-01 12:00:00" }, "cfb")).toBe(true);
    expect(inWindow({ gd: "2026-08-26", posted: "2026-08-26 12:00:00" }, "cfb")).toBe(false);
    expect(inWindow({ gd: null, posted: "2026-09-09 08:00:00" }, "nfl")).toBe(true);
    expect(windowDate({ gd: "2026-08-27", posted: "2026-08-01 12:00:00" }).basis).toBe("game");
    expect(windowDate({ gd: null, posted: "2026-09-09 08:00:00" }).basis).toBe("posted");
  });

  it("classifies singles vs parlays / SGP / multi-leg", () => {
    expect(classifyParlay({ n: 1, bt: "ML", ps: "" })).toBe("single");
    expect(classifyParlay({ n: 4, bt: "parlay", ps: "" })).toBe("multi");
    expect(classifyParlay({ n: null, bt: "SGP", ps: "" })).toBe("multi");
    expect(classifyParlay({ n: 4, bt: "PrizePicks/DFS", ps: "" })).toBe("multi");
    expect(classifyParlay({ n: 1, bt: "PrizePicks/DFS", ps: "" })).toBe("single");
  });
});

describe("sample40 fixture", () => {
  it("loads 40 rows and skips Trent units-only slips from dollar P/L", () => {
    expect(SAMPLE).toHaveLength(40);
    const lost = SAMPLE.find(
      (b) => b.who === "Trent" && b.units === 10 && b.stake == null && b.res === "L",
    );
    expect(lost).toBeTruthy();
    expect(dollarPl(lost!)).toBeNull();
    expect(unitsPl(lost!)).toBe(-10);
    const first = SAMPLE[0];
    expect(dollarPl(first)).toBe(-1000);
    const nfl = filterBets(SAMPLE, { window: "nfl", sport: "NFL" });
    expect(nfl.every((b) => b.sport === "NFL")).toBe(true);
  });
});

function baseBet(overrides: Partial<BetRow>): BetRow {
  return {
    id: "T-1",
    who: "Trent",
    posted: "2026-09-10 12:00:00",
    gd: "2026-09-10",
    kt: null,
    prime: "N",
    slot: "",
    sport: "NFL",
    lg: "NFL",
    bt: "ML",
    legs: "KC ML",
    n: 1,
    odds: "+100",
    dec: 2,
    stake: 100,
    units: null,
    towin: 100,
    book: "Test",
    res: "W",
    src: "",
    promo: "N",
    url: "",
    notes: "",
    ps: "Single",
    ...overrides,
  };
}
