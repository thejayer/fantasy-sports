import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { BetRow } from "./bets";
import {
  americanToDecimal,
  bettorKpis,
  classifyParlay,
  dollarPl,
  formatUnits,
  fadePl,
  filterBets,
  inWindow,
  invertResult,
  parseBetTab,
  parseOdds,
  stripValuePrefix,
  safeHttpUrl,
  bettorMeta,
  isHypothetical1u,
  uniqueBettors,
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

describe("data-driven bettors and fade math", () => {
  it("lists whoever appears, not a closed Trent/Steve set", () => {
    expect(uniqueBettors(SAMPLE)).toEqual(["Trent"]);
    expect(
      uniqueBettors([
        baseBet({ who: "chellgod" }),
        baseBet({ who: "Trent" }),
        baseBet({ who: "chellgod" }),
        baseBet({ who: "btidy216" }),
      ]),
    ).toEqual(["chellgod", "btidy216", "Trent"]);
    expect(
      uniqueBettors([
        baseBet({ who: "Trent" }),
        baseBet({ who: "SJ Bot" }),
      ]),
    ).toEqual(["Trent"]);
  });

  it("parses tabs and strips Value prefixes", () => {
    expect(parseBetTab("parlays")).toBe("parlays");
    expect(parseBetTab("warnings")).toBe("warnings");
    expect(parseBetTab("splits")).toBe("splits");
    expect(parseBetTab("tail")).toBe("tail");
    expect(parseBetTab("tailing")).toBe("tail");
    expect(parseBetTab("bot")).toBe("bot");
    expect(parseBetTab("")).toBe("bets");
    expect(stripValuePrefix("Value")).toBe("");
    expect(stripValuePrefix("Value -6.5")).toBe("-6.5");
    expect(invertResult("W")).toBe("L");
    expect(fadePl("W")).toBeCloseTo(100 * (100 / 110));
    expect(fadePl("L")).toBe(-100);
    expect(fadePl("Pending")).toBeNull();
  });

  it("keeps only http(s) feed links", () => {
    expect(safeHttpUrl("https://x.com/chellgod")).toBe("https://x.com/chellgod");
    expect(safeHttpUrl("http://example.com/a")).toBe("http://example.com/a");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,hi")).toBeNull();
    expect(safeHttpUrl("/relative")).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl(bettorMeta("chellgod").href)).toBe("https://x.com/chellgod");
    expect(safeHttpUrl(bettorMeta("odd name?").href)).toBe("https://x.com/oddname");
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
    pick_class: "",
    ...overrides,
  };
}

describe("laurencowling display name", () => {
  it("renders Lauren (LC) without changing the feed key", () => {
    expect(bettorMeta("laurencowling").name).toBe("Lauren (LC)");
    expect(bettorMeta("laurencowling").handle).toBe("laurencowling");
  });
});

describe("laurencowling (LC): payout-only $ and no units", () => {
  it("prices a win from the posted payout when odds are not shown", () => {
    const bet = { res: "W", stake: 198.02, odds: "not shown", dec: 2.232, towin: 442 };
    expect(dollarPl(bet)).toBeCloseTo(243.98, 6);
    expect(dollarPl({ ...bet, odds: "+150", towin: 999, stake: 100, dec: null })).toBeCloseTo(150, 6);
  });

  it("shows Lauren (LC) and leaves units blank (no NaN / 0u)", () => {
    expect(bettorMeta("laurencowling")).toEqual({
      name: "Lauren (LC)",
      handle: "laurencowling",
      href: "https://x.com/laurencowling",
    });
    const kpi = bettorKpis([
      { ...baseBet({ who: "laurencowling" }), res: "W", stake: 100, odds: "not shown", dec: null, towin: 250, units: null },
      { ...baseBet({ who: "laurencowling" }), res: "L", stake: 50, odds: "-110", dec: null, towin: null, units: null },
    ]);
    expect(kpi.pl).toBeCloseTo(100, 6);
    expect(kpi.unitsPl).toBeNull();
    expect(kpi.unitsRoi).toBeNull();
    expect(formatUnits(kpi.unitsPl)).toBe("—");
    expect(formatUnits(kpi.unitsPl)).not.toMatch(/NaN|0u/);
  });
});

describe("Lockedin_Sportz: hypothetical 1u", () => {
  it("maps the display overlay and labels missing stake as 1u", () => {
    expect(bettorMeta("Lockedin_Sportz")).toEqual({
      name: "Lockedin_Sportz",
      handle: "Lockedin_Sportz",
      href: "https://x.com/Lockedin_Sportz",
      hypothetical1u: true,
    });
    const kpi = bettorKpis([
      baseBet({
        id: "Z-1",
        who: "Lockedin_Sportz",
        res: "W",
        stake: null,
        units: null,
        odds: null,
        dec: null,
        towin: null,
        pick_class: "Prop",
      }),
      baseBet({
        id: "Z-2",
        who: "Lockedin_Sportz",
        res: "L",
        stake: null,
        units: null,
        odds: null,
        dec: null,
        pick_class: "Prop",
      }),
    ]);
    expect(kpi.pl).toBeNull();
    expect(kpi.unitsPl).toBeNull();
    expect(kpi.flat1uPl).toBeCloseTo(100 / 110 - 1, 6);
    expect(formatUnits(kpi.flat1uPl)).not.toMatch(/NaN/);
    expect(isHypothetical1u("Lockedin_Sportz")).toBe(true);
  });
});
