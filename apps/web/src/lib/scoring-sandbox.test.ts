import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { LeagueSnapshot, WeekBoxScoreSnapshot } from "@/lib/data";
import {
  applyWeightDelta,
  buildScoringSandboxModel,
  compareCategory,
  defaultTweaks,
  outcomeFromScores,
  simulateBaseball,
  simulateFootball,
  simulateGolf,
  simulateHockey,
} from "@/lib/scoring-sandbox";

const FIXTURES = path.resolve(process.cwd(), "../../fixtures/sj");

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(path.join(FIXTURES, rel), "utf8")) as T;
}

function footballLeague(): LeagueSnapshot {
  return loadJson<LeagueSnapshot>("football-main/2026.json");
}

function week(n: 13 | 14): WeekBoxScoreSnapshot {
  return loadJson<WeekBoxScoreSnapshot>(`football-main/2026/weeks/${n}.json`);
}

describe("scoring sandbox math (roadmap 8.4)", () => {
  it("applies only the weight delta against an official total", () => {
    expect(
      applyWeightDelta(100, { REC: 8, PTD: 2 }, { PTD: 4, REC: 0 }, { PTD: 4, REC: 1 }),
    ).toBe(108);
    expect(
      applyWeightDelta(18.7, { PTD: 2 }, { PTD: 4 }, { PTD: 6 }),
    ).toBeCloseTo(22.7);
  });

  it("compares category wins with invert", () => {
    expect(compareCategory(4, 2, false)).toBe("W");
    expect(compareCategory(3.2, 2.8, true)).toBe("L");
    expect(compareCategory(1, 1, false)).toBe("T");
  });

  it("rebuilds week 14 starter points when PPR turns on", () => {
    const league = footballLeague();
    const model = buildScoringSandboxModel(league, [week(13), week(14)]);
    expect(model.football?.weeks.map((w) => w.week)).toEqual([13, 14]);
    expect(model.items.some((i) => i.key === "REC")).toBe(true);

    const official = defaultTweaks(model);
    const baseline = simulateFootball(model, official.weights, 14);
    const home = baseline.matchups.find((m) => m.homeId === 2 && m.awayId === 1);
    expect(home).toBeTruthy();
    expect(home!.officialOutcome).toBe("W");
    expect(home!.simulatedOutcome).toBe("W");
    expect(home!.flipped).toBe(false);
    expect(home!.homeOfficial).toBeCloseTo(127.9);
    expect(home!.awayOfficial).toBeCloseTo(103.2);

    const ppr = { ...official.weights, REC: (official.weights.REC ?? 0) + 1 };
    const tweaked = simulateFootball(model, ppr, 14);
    const after = tweaked.matchups.find((m) => m.homeId === 2 && m.awayId === 1);
    expect(after).toBeTruthy();
    // Away fixture line has more receptions — +1 PPR must move them past home.
    expect(after!.awaySim - after!.homeSim).toBeGreaterThan(0);
    expect(after!.simulatedOutcome).toBe("L");
    expect(after!.flipped).toBe(true);
    expect(after!.officialOutcome).toBe("W");
  });

  it("does not change week W-L when weights stay official", () => {
    const league = footballLeague();
    const model = buildScoringSandboxModel(league, [week(14)]);
    const result = simulateFootball(model, defaultTweaks(model).weights, 14);
    for (const row of result.matchups) {
      expect(row.flipped).toBe(false);
      expect(outcomeFromScores(row.homeOfficial, row.awayOfficial)).toBe(
        row.officialOutcome,
      );
    }
  });

  it("rewights baseball Season Points from roster HR", () => {
    const league = loadJson<LeagueSnapshot>("baseball-dynasty/2026.json");
    const model = buildScoringSandboxModel(league, []);
    expect(model.baseball?.mode).toBe("season_points");
    const hr = model.items.find((i) => i.key === "HR");
    expect(hr?.official).toBe(5);

    const official = simulateBaseball(model, defaultTweaks(model));
    const doubled = defaultTweaks(model);
    doubled.weights.HR = 10;
    const sim = simulateBaseball(model, doubled);

    const before = official.teams.find((t) => t.teamId === 1);
    const after = sim.teams.find((t) => t.teamId === 1);
    expect(before).toBeTruthy();
    expect(after).toBeTruthy();
    expect(after!.delta).toBeGreaterThan(0);
    expect(after!.statDeltas.HR).toBeCloseTo(after!.delta, 5);
    expect(after!.simulated).toBeCloseTo(before!.official + after!.delta);
  });

  it("shows baseball category rank flips when a cat is dropped", () => {
    const league = loadJson<LeagueSnapshot>("baseball-dynasty/2026.json");
    const model = buildScoringSandboxModel(league, []);
    // Force category mode over the same counting totals (H2H cat leagues).
    model.baseball = {
      ...model.baseball!,
      mode: "category",
    };
    model.items = (model.baseball.categories ?? []).map((cat) => ({
      key: cat.id,
      label: cat.label,
      official: 1,
      kind: "toggle" as const,
      step: 1,
      min: 0,
      max: 1,
    }));
    const tweaks = defaultTweaks(model);
    const full = simulateBaseball(model, tweaks);
    tweaks.enabled.HR = false;
    const dropped = simulateBaseball(model, tweaks);
    expect(full.mode).toBe("category");
    expect(dropped.teams[0]?.rotoOfficial).toBeDefined();
    const moved = dropped.teams.some(
      (row, i) => row.teamId !== full.teams[i]?.teamId || row.delta !== 0,
    );
    expect(moved || dropped.teams.some((t) => t.delta !== 0)).toBe(true);
  });

  it("rescored golf week totals move when Thu/Fri keep drops", () => {
    const league = loadJson<LeagueSnapshot>("golf-main/2026.json");
    const model = buildScoringSandboxModel(league, []);
    expect(model.sport).toBe("golf");
    expect(model.golf?.events.length).toBeGreaterThan(0);
    const official = simulateGolf(model, defaultTweaks(model).golf);
    const tighter = defaultTweaks(model);
    tighter.golf.thuFriCount = 3;
    const sim = simulateGolf(model, tighter.golf);
    const changed = sim.teams.some((row) => {
      const base = official.teams.find((t) => t.teamId === row.teamId);
      return base != null && Math.abs(row.simulated - base.simulated) > 0.05;
    });
    expect(changed).toBe(true);
  });

  it("rewights hockey H2H points from roster goals", () => {
    const league = loadJson<LeagueSnapshot>("hockey-main/2026.json");
    const model = buildScoringSandboxModel(league, []);
    expect(model.sport).toBe("hockey");
    expect(model.hockey?.mode).toBe("season_points");
    const goals = model.items.find((i) => i.key === "G");
    expect(goals?.official).toBe(3);

    const official = simulateHockey(model, defaultTweaks(model));
    const doubled = defaultTweaks(model);
    doubled.weights.G = 6;
    const sim = simulateHockey(model, doubled);
    const before = official.teams.find((t) => t.teamId === 1);
    const after = sim.teams.find((t) => t.teamId === 1);
    expect(before).toBeTruthy();
    expect(after).toBeTruthy();
    expect(after!.delta).toBeGreaterThan(0);
    expect(after!.statDeltas.G).toBeCloseTo(after!.delta, 5);
  });

  it("shows Empty hockey model when stats and weights are missing", () => {
    const league = loadJson<LeagueSnapshot>("hockey-main/2026.json");
    const stripped: LeagueSnapshot = {
      ...league,
      settings: { ...league.settings, scoring_format: [], categories: [] },
      teams: league.teams.map((team) => ({
        ...team,
        roster: team.roster.map((player) => ({ ...player, season_stats: {} })),
      })),
    };
    const model = buildScoringSandboxModel(stripped, []);
    const hasStats = model.hockey?.teams.some((t) => Object.keys(t.stats).length);
    expect(hasStats).toBe(false);
  });
});
