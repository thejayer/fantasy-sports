import { describe, expect, it } from "vitest";

import { isHypothetical1u, parseBetTab } from "./bets";
import {
  ALL_WHO,
  coerceSplitKind,
  fadeTone,
  filterSplitRows,
  groupSplitsByWho,
  splitLabel,
  uniqueSplitBettors,
  type SplitRow,
} from "./bets-splits";

function row(overrides: Partial<SplitRow>): SplitRow {
  return {
    who: "*",
    source: "bets",
    klass: "prop",
    kind: "single_prop",
    sport: null,
    section: "main",
    n: null,
    wins: 0,
    losses: 2,
    pushes: 0,
    pending: 0,
    unknown: 0,
    record: "0-2-0",
    win_pct: 0,
    units_pl: null,
    pl: null,
    staked: null,
    flat_1u: -2,
    fade_1u: 1.82,
    fade_plus: true,
    fade_emphasis: true,
    ...overrides,
  };
}

describe("record splits helpers", () => {
  it("parses the splits tab and labels kinds", () => {
    expect(parseBetTab("splits")).toBe("splits");
    expect(parseBetTab("record")).toBe("splits");
    expect(splitLabel("ticket")).toBe("Whole parlay tickets");
    expect(splitLabel("single_prop")).toBe("Single player props");
  });

  it("groups all-bettors first and emphasizes ticket / single-prop fades", () => {
    const rows = [
      row({ who: "Trent", kind: "single_team", fade_plus: false, fade_emphasis: false, fade_1u: -1 }),
      row({ who: ALL_WHO, kind: "ticket", fade_plus: true, fade_emphasis: true, fade_1u: 0.91 }),
      row({ who: "Lockedin_Sportz", kind: "single_prop", fade_plus: true, fade_emphasis: true }),
      row({ who: ALL_WHO, kind: "single_prop" }),
    ];
    const groups = groupSplitsByWho(rows);
    expect(groups.map((g) => g.who)).toEqual([ALL_WHO, "Lockedin_Sportz", "Trent"]);
    expect(groups[0].rows.map((r) => r.kind)).toEqual(["single_prop", "ticket"]);
    expect(fadeTone(rows[1])).toBe("edge");
    expect(fadeTone(row({ kind: "leg_team", fade_plus: true, fade_emphasis: false }))).toBe("plus");
    expect(fadeTone(row({ fade_plus: false, fade_emphasis: false, fade_1u: -1 }))).toBeNull();
  });

  it("coerces live display class labels when kind is other", () => {
    expect(
      coerceSplitKind(
        row({
          kind: "other",
          klass: "single bets – player props",
          source: "bets",
        }),
      ),
    ).toBe("single_prop");
    expect(
      coerceSplitKind(row({ kind: "other", klass: "whole parlay tickets", source: "bets" })),
    ).toBe("ticket");
    const groups = groupSplitsByWho([
      row({
        who: "Lauren (laurencowling)",
        kind: "other",
        klass: "whole parlay tickets",
        fade_1u: 2,
        fade_plus: false,
        fade_emphasis: false,
      }),
    ]);
    expect(groups.map((g) => g.who)).toEqual(["laurencowling"]);
    expect(groups[0].rows[0].kind).toBe("ticket");
    expect(fadeTone(groups[0].rows[0])).toBe("edge");
  });

  it("filters by bettor and lists people other than *", () => {
    const rows = [
      row({ who: ALL_WHO }),
      row({ who: "Lockedin_Sportz" }),
      row({ who: "Trent", kind: "single_team" }),
    ];
    expect(uniqueSplitBettors(rows)).toEqual(["Lockedin_Sportz", "Trent"]);
    expect(filterSplitRows(rows, { who: "Trent" })).toHaveLength(1);
  });
});

describe("Lockedin_Sportz mapping", () => {
  it("flags hypothetical 1u P/L like LC was display-mapped", () => {
    expect(isHypothetical1u("Lockedin_Sportz")).toBe(true);
    expect(isHypothetical1u("@Lockedin_Sportz")).toBe(true);
    expect(isHypothetical1u("laurencowling")).toBe(false);
    expect(isHypothetical1u("Trent")).toBe(false);
  });
});
