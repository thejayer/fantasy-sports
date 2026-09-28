import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  backtestLine,
  effectiveRecent,
  seasonLabel,
  formatPercent,
  formatValue,
  HOCKEY_BOARD_PAGE_SIZE,
  hockeyBoardRows,
  hockeyValueIndex,
  parseHockeyBoardQuery,
  parseRecent,
  partWeight,
  reblend,
  recentLabel,
  type HockeyPlayerValue,
  type HockeyValuesSnapshot,
} from "@/lib/hockey-values";

const FIXTURES = path.resolve(process.cwd(), "../../fixtures/sj");

function fixtureValues(): HockeyValuesSnapshot {
  return JSON.parse(
    readFileSync(path.join(FIXTURES, "hockey-main/2027/nhl/values.json"), "utf8"),
  ) as HockeyValuesSnapshot;
}

function player(overrides: Partial<HockeyPlayerValue>): HockeyPlayerValue {
  return {
    espn_id: 1,
    name: "Test",
    position: "C",
    group: "F",
    pro_team: "TOR",
    nhl_id: 1,
    nhl_team: "TOR",
    fantasy_team_id: null,
    rostered: false,
    injury_status: null,
    age: 25,
    value: null,
    base: null,
    mult: 1,
    adjustments: [],
    parts: [],
    source: "history",
    durability: { rate: 1, basis: "", iron_man: false },
    remaining_games: null,
    ros: null,
    espn_proj: null,
    ...overrides,
  };
}

describe("hockey values (HOCKEY-PORT H2/H3)", () => {
  it("re-blends to exactly what nhl.value exported at the default setting", () => {
    const snap = fixtureValues();
    const players = Object.values(snap.players);
    expect(players.length).toBeGreaterThan(50);
    for (const p of players) {
      const b = reblend(p, snap.recent_default);
      expect(b.base).toBeCloseTo(p.base!, 2);
      expect(b.value).toBeCloseTo(p.value!, 2);
      if (p.ros != null) expect(b.ros).toBeCloseTo(p.ros, 0);
      const shares = b.parts.reduce((sum, part) => sum + part.share, 0);
      expect(shares).toBeCloseTo(1, 6);
    }
  });

  it("mirrors the weight table", () => {
    const part = { label: "x", fpg: 1, gp: 10 };
    expect(partWeight({ ...part, kind: "trailing", base: 0.15, games_factor: 1 }, 0.5)).toBeCloseTo(0.075);
    expect(partWeight({ ...part, kind: "season", base: 0.35, games_factor: 0.4 }, 0.5)).toBeCloseTo(0.14);
    expect(partWeight({ ...part, kind: "projection", base: 0, games_factor: 1 }, 0.5)).toBeCloseTo(0.3);
    expect(partWeight({ ...part, kind: "history", base: 0, games_factor: 0.5 }, 1)).toBeCloseTo(0.075);
    expect(partWeight({ ...part, kind: "prospect", base: 0.15, games_factor: 1 }, 0)).toBeCloseTo(0.15);
  });

  it("recent form moves value toward trailing windows", () => {
    const p = player({
      mult: 1.1,
      remaining_games: 10,
      durability: { rate: 0.9, basis: "", iron_man: false },
      parts: [
        { kind: "trailing", label: "last 7 days", fpg: 4, gp: 3, base: 0.1, games_factor: 1 },
        { kind: "projection", label: "ESPN projection", fpg: 2, gp: 78, base: 0, games_factor: 1 },
      ],
    });
    const low = reblend(p, 0);
    const high = reblend(p, 1);
    expect(low.base).toBeCloseTo(2);
    expect(high.base!).toBeGreaterThan(low.base!);
    expect(low.value).toBeCloseTo(2.2);
    expect(low.ros).toBeCloseTo(2.2 * 10 * 0.9);
    expect(reblend(player({}), 0.5)).toEqual({ base: null, value: null, ros: null, parts: [] });
    // Only trailing at recent 0: every weight zero, plain mean instead of NaN.
    const only = player({ parts: [p.parts[0]] });
    expect(reblend(only, 0).base).toBe(4);
  });

  it("parses the board query and recent-form steps", () => {
    expect(parseRecent(undefined)).toBe(0.5);
    expect(parseRecent("0.8")).toBe(0.75);
    expect(parseRecent("7")).toBe(1);
    expect(parseRecent("nope")).toBe(0.5);
    expect(recentLabel(0)).toBe("Track record");
    expect(recentLabel(1)).toBe("Recent form");
    expect(parseHockeyBoardQuery({})).toEqual({
      pos: "all", who: "all", sort: "value", dir: "desc", page: 1, recent: null, open: null,
    });
    expect(parseHockeyBoardQuery({ recent: "0" }).recent).toBe(0);
    // No ?recent= → the model's shipped default, not a hard-coded 0.5.
    const snap = { recent_default: 0.25 } as HockeyValuesSnapshot;
    expect(effectiveRecent(snap, { recent: null })).toBe(0.25);
    expect(effectiveRecent(snap, { recent: 1 })).toBe(1);
    expect(effectiveRecent(null, { recent: null })).toBe(0.5);
    expect(parseHockeyBoardQuery({ open: "12345" }).open).toBe("12345");
    expect(parseHockeyBoardQuery({ open: "<script>" }).open).toBeNull();
    expect(parseHockeyBoardQuery({ pos: "G", who: "fa", sort: "name", p: "3" })).toMatchObject({
      pos: "G", who: "fa", sort: "name", dir: "asc", page: 3,
    });
    expect(parseHockeyBoardQuery({ pos: "QB", sort: "vor" })).toMatchObject({ pos: "all", sort: "value" });
  });

  it("filters, sorts with nulls last, and pages", () => {
    const snap = fixtureValues();
    const all = hockeyBoardRows(snap, parseHockeyBoardQuery({}));
    expect(all.total).toBe(Object.keys(snap.players).length);
    expect(all.rows.length).toBe(Math.min(HOCKEY_BOARD_PAGE_SIZE, all.total));
    const values = all.rows.map((r) => r.blended.value ?? -Infinity);
    expect(values).toEqual([...values].sort((a, b) => b - a));

    const goalies = hockeyBoardRows(snap, parseHockeyBoardQuery({ pos: "G" }));
    expect(goalies.rows.every((r) => r.group === "G")).toBe(true);
    const fas = hockeyBoardRows(snap, parseHockeyBoardQuery({ who: "fa" }));
    expect(fas.rows.every((r) => !r.rostered)).toBe(true);

    const last = hockeyBoardRows(snap, parseHockeyBoardQuery({ p: "999" }));
    expect(last.page).toBe(last.pages);

    const withNull = {
      ...snap,
      players: {
        a: player({ espn_id: 1, name: "Has", parts: [{ kind: "role", label: "r", fpg: 1, gp: null, base: 1, games_factor: 1 }] }),
        b: player({ espn_id: 2, name: "Empty" }),
      },
    };
    for (const dir of ["asc", "desc"]) {
      const rows = hockeyBoardRows(withNull, parseHockeyBoardQuery({ dir })).rows;
      expect(rows.map((r) => r.name)).toEqual(["Has", "Empty"]);
    }
  });

  it("summarizes the backtest in one sentence", () => {
    expect(backtestLine(null)).toBeNull();
    expect(backtestLine(undefined)).toBeNull();
    const line = backtestLine({
      seasons: ["20222023", "20232024", "20242025", "20252026"],
      checkpoints: ["preseason", "dec1", "feb1"],
      mae_by_group: { F: 0.41, D: 0.3, G: 1.38 },
      bias: 0.05,
      spearman: 0.826,
      n: 8520,
    });
    expect(line).toBe(
      "Backtested on 2022–23 to 2025–26 (8,520 player checks): typical miss per game — forwards 0.41, defense 0.30, goalies 1.38; rank correlation 0.83.",
    );
    expect(seasonLabel("20262027")).toBe("2026–27");
  });

  it("indexes roster and Waivers cells and formats nulls as a dash", () => {
    const snap = fixtureValues();
    const [first] = Object.keys(snap.players);
    const index = hockeyValueIndex(snap, [first, null, "nobody"]);
    expect(Object.keys(index)).toEqual([first]);
    expect(hockeyValueIndex(null, [first])).toEqual({});
    expect(formatValue(null)).toBe("—");
    expect(formatValue(2.345)).toBe("2.35");
    expect(formatPercent(0.951)).toBe("95%");
    expect(formatPercent(undefined)).toBe("—");
  });
});
