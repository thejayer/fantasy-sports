import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseBetTab } from "./bets";
import {
  OPTIONS_FOOTNOTE,
  cumulativePlSeries,
  filterOptionTrades,
  formatClosedRecord,
  formatOptionPct,
  formatOptionPl,
  optionsHref,
  parseOptionFilter,
  plDisplay,
  postedPl,
  uniqueOptionTraders,
  uniqueOptionValues,
  type OptionTrade,
  type OptionsDocument,
} from "./bets-options";

const FIX = path.resolve(__dirname, "../../fixtures/bets");

function loadFixture(): OptionsDocument {
  return JSON.parse(readFileSync(path.join(FIX, "options.json"), "utf8")) as OptionsDocument;
}

describe("options fixture", () => {
  it("is labeled simulated and stays out of betting totals", () => {
    const doc = loadFixture();
    expect(doc.simulated).toBe(true);
    expect(doc.schema).toBe("sj-options-v1");
    expect(doc.trades.length).toBe(74);
    expect(doc.footnote).toBe(OPTIONS_FOOTNOTE);
    expect(doc.traders.map((row) => row.name)).toEqual([
      "Sample Trader B",
      "Sample Trader A",
    ]);
    const a = doc.traders.find((row) => row.name === "Sample Trader A");
    const b = doc.traders.find((row) => row.name === "Sample Trader B");
    expect(a?.open).toBe(3);
    expect(a?.has_daily_recap).toBe(false);
    expect(a?.green_days).toBeNull();
    expect(b?.has_daily_recap).toBe(true);
    expect(b?.green_days).toBe(34);
    expect(b?.red_days).toBe(11);
    expect(JSON.stringify(doc)).not.toContain("sheet_id");
    expect(JSON.stringify(doc)).not.toMatch(/@gmail\.com/);
  });
});

describe("posted P/L display", () => {
  const open: OptionTrade = { id: "O1", trader: "A", status: "Open", pl: null };
  const blank: OptionTrade = { id: "O2", trader: "A", status: "Closed", pl: null };
  const win: OptionTrade = { id: "O3", trader: "A", status: "Closed", pl: 40 };

  it("shows Open / not posted / value and never infers blank P/L", () => {
    expect(plDisplay(open)).toBe("open");
    expect(formatOptionPl(open)).toBe("Open");
    expect(plDisplay(blank)).toBe("not_posted");
    expect(formatOptionPl(blank)).toBe("not posted");
    expect(plDisplay(win)).toBe("value");
    expect(postedPl(blank)).toBeNull();
    expect(formatOptionPct(null)).toBe("—");
    expect(formatOptionPct(0.5)).toBe("50.0%");
    expect(formatClosedRecord(4, 1)).toBe("4–1");
  });
});

describe("filters and cumulative series", () => {
  it("filters by trader / type / status and charts posted P/L only", () => {
    const doc = loadFixture();
    const opens = filterOptionTrades(doc.trades, { status: "Open" });
    expect(opens.length).toBe(3);
    expect(opens.every((row) => row.pl == null)).toBe(true);
    const recaps = filterOptionTrades(doc.trades, {
      trader: "Sample Trader B",
      type: "Daily recap",
    });
    expect(recaps.length).toBe(46);
    const series = cumulativePlSeries(doc.trades);
    expect(series.map((row) => row.trader)).toEqual([
      "Sample Trader A",
      "Sample Trader B",
    ]);
    const lastA = series[0]?.points.at(-1);
    const lastB = series[1]?.points.at(-1);
    expect(lastA?.cum).toBe(446000);
    expect(lastB?.cum).toBeCloseTo(3403.32);
    expect(series[0]?.points.every((point) => Number.isFinite(point.pl))).toBe(true);
  });

  it("parses the options tab and builds filter hrefs", () => {
    expect(parseBetTab("options")).toBe("options");
    expect(uniqueOptionTraders(loadFixture().trades)).toEqual([
      "Sample Trader B",
      "Sample Trader A",
    ]);
    expect(uniqueOptionValues(loadFixture().trades, "type")).toContain("Daily recap");
    expect(parseOptionFilter("Call", ["Call", "Put"])).toBe("Call");
    expect(parseOptionFilter("future", ["Call"])).toBe("");
    expect(optionsHref({ who: "Sample Trader A", type: "Call", status: "Open" })).toBe(
      "/bets?tab=options&who=Sample+Trader+A&type=Call&status=Open",
    );
  });
});
