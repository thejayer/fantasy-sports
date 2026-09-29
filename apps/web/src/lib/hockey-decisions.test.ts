import { describe, expect, it } from "vitest";

import {
  MAX_GOALIES,
  compareFreeAgents,
  depthChart,
  evaluateMove,
  formatDelta,
  gamesInWindow,
  parseIds,
  parseWaiverFilters,
  waiverBoard,
  windowPoints,
  windowStart,
  type DecisionContext,
  type HockeyScheduleSnapshot,
} from "@/lib/hockey-decisions";
import type { HockeyBio } from "@/lib/hockey-nhl";
import type { HockeyPlayerValue, HockeyValuesSnapshot } from "@/lib/hockey-values";

function pv(id: number, partial: Partial<HockeyPlayerValue>): HockeyPlayerValue {
  return {
    espn_id: id,
    name: `P${id}`,
    position: "C",
    group: "F",
    pro_team: "BOS",
    nhl_id: id + 8_000_000,
    nhl_team: "BOS",
    fantasy_team_id: null,
    rostered: false,
    injury_status: "ACTIVE",
    age: 25,
    value: 3,
    base: 3,
    mult: 1,
    adjustments: [],
    parts: [],
    source: "full",
    durability: { rate: 1, basis: "test", iron_man: false },
    remaining_games: 10,
    ros: 30,
    espn_proj: null,
    ...partial,
  } as HockeyPlayerValue;
}

function bio(partial: Partial<HockeyBio>): HockeyBio {
  return {
    nhlId: 1,
    age: 25,
    heightIn: 72,
    weightLb: 190,
    team: "BOS",
    priorTeam: null,
    evMin: null,
    ppMin: null,
    toiBasis: null,
    role: null,
    pp: null,
    linemates: [],
    teamUrl: null,
    roleBasis: null,
    injury: null,
    possibleScratch: false,
    ...partial,
  };
}

const schedule: HockeyScheduleSnapshot = {
  league_id: "hockey-main",
  season: 2027,
  sport: "hockey",
  teams: {
    BOS: [
      { date: "2026-10-07", opp: "TOR", home: true },
      { date: "2026-10-09", opp: "MTL", home: false },
      { date: "2026-10-12", opp: "NYR", home: true },
      { date: "2026-10-18", opp: "OTT", home: true },
    ],
    TOR: [{ date: "2026-10-07", opp: "BOS", home: false }],
  },
};

function values(players: HockeyPlayerValue[]): HockeyValuesSnapshot {
  return {
    schema_version: 1,
    league_id: "hockey-main",
    season: 2027,
    sport: "hockey",
    nhl_season: "20262027",
    generated_at: "2026-07-27T00:00:00Z",
    as_of: "2026-07-27",
    recent_default: 0.25,
    scoring_source: "test",
    weights: {},
    players: Object.fromEntries(players.map((p) => [String(p.espn_id), p])),
  };
}

// Team 1: forwards 11 (2.0), 12 (4.0), 13 (1.0, injured); defense 14;
// goalies 15/16. Team 2 owns 31. Free agents 21–25.
const roster = [
  pv(11, { rostered: true, fantasy_team_id: 1, value: 2 }),
  pv(12, { rostered: true, fantasy_team_id: 1, value: 4 }),
  pv(13, { rostered: true, fantasy_team_id: 1, value: 1, injury_status: "OUT" }),
  pv(14, { rostered: true, fantasy_team_id: 1, value: 2.5, group: "D", position: "D" }),
  pv(15, { rostered: true, fantasy_team_id: 1, value: 3, group: "G", position: "G" }),
  pv(16, { rostered: true, fantasy_team_id: 1, value: 2, group: "G", position: "G" }),
  pv(31, { rostered: true, fantasy_team_id: 2, value: 9 }),
];
const agents = [
  pv(21, { value: 3.5, durability: { rate: 0.5, basis: "t", iron_man: false }, ros: 20 }),
  pv(22, { value: 3, age: 21, source: "rookie" as HockeyPlayerValue["source"], ros: 25 }),
  pv(23, {
    value: 2.2,
    group: "D",
    position: "D",
    durability: { rate: 0.97, basis: "t", iron_man: true },
  }),
  pv(24, { value: 2.8, group: "G", position: "G", injury_status: "INJURY_RESERVE" }),
  pv(25, { value: 1.5 }),
];

const ctx: DecisionContext = {
  values: values([...roster, ...agents]),
  bios: {
    "21": bio({ pp: "PP1", heightIn: 76 }),
    "22": bio({ pp: "No PP", heightIn: 70, possibleScratch: true }),
  },
  schedule,
  start: "2026-10-07",
};

describe("schedule window", () => {
  it("pins fixtures and preseason to the first slate date", () => {
    const v = values([]);
    expect(windowStart(v, schedule, new Date("2026-09-28T12:00:00Z"))).toBe("2026-10-07");
    // Fixture stamp: still the slate even when the wall clock is past it.
    expect(windowStart(v, schedule, new Date("2027-01-15T12:00:00Z"))).toBe("2026-10-07");
    // Live snapshot mid-season: today.
    const live = { ...v, generated_at: "2026-12-01T09:00:00Z", as_of: "2026-12-01" };
    expect(windowStart(live, schedule, new Date("2026-12-03T12:00:00Z"))).toBe("2026-12-03");
  });

  it("counts club games in a half-open window and scales by share played", () => {
    expect(gamesInWindow("BOS", schedule, "2026-10-07", 7)).toBe(3);
    expect(gamesInWindow("BOS", schedule, "2026-10-07", 14)).toBe(4);
    expect(gamesInWindow("XXX", schedule, "2026-10-07", 7)).toBeNull();
    expect(windowPoints(agents[0]!, schedule, "2026-10-07", 7)).toBeCloseTo(3.5 * 3 * 0.5);
  });
});

describe("waiver board", () => {
  it("measures upgrades against the weakest healthy player in the group", () => {
    const rows = waiverBoard(ctx, 1);
    expect(rows.map((r) => r.espnId)).toEqual(["21", "22", "24", "23", "25"]);
    const f = rows.find((r) => r.espnId === "21")!;
    // 13 (1.0) is injured, so 11 (2.0) is the forward to beat.
    expect(f.replaces?.espnId).toBe("11");
    expect(f.upgrade).toBeCloseTo(1.5);
    expect(rows.find((r) => r.espnId === "23")!.upgrade).toBeCloseTo(-0.3);
    expect(rows.find((r) => r.espnId === "24")!.replaces?.espnId).toBe("16");
  });

  it("has no upgrade column without a team", () => {
    expect(waiverBoard(ctx, null).every((r) => r.upgrade == null)).toBe(true);
  });

  it("applies each filter", () => {
    const ids = (raw: Record<string, string>) =>
      waiverBoard(ctx, 1, parseWaiverFilters(raw)).map((r) => r.espnId);
    expect(ids({ pos: "D" })).toEqual(["23"]);
    expect(ids({ healthy: "1" })).not.toContain("24");
    expect(ids({ pp: "1" })).toEqual(["21"]);
    expect(ids({ rookies: "1" })).toEqual(["22"]);
    expect(ids({ tall: "1" })).toEqual(["21"]);
    expect(ids({ iron: "1" })).toEqual(["23"]);
    expect(ids({ pos: "X", healthy: "yes" })).toHaveLength(5);
  });
});

describe("compare", () => {
  it("parses up to four numeric ids, deduped", () => {
    expect(parseIds(["21", "22,x", "21"])).toEqual(["21", "22"]);
    expect(parseIds("1,2,3,4,5")).toEqual(["1", "2", "3", "4"]);
    expect(parseIds(undefined)).toEqual([]);
  });

  it("marks the best per metric and splits the verdict when they differ", () => {
    const cmp = compareFreeAgents(ctx, ["21", "22"]);
    expect(cmp.best.value).toBe("21");
    // 22 plays every game; 21 plays half → 22 wins the 14-day window.
    expect(cmp.best.next14).toBe("22");
    expect(cmp.best.age).toBe("22");
    expect(cmp.verdict).toContain("P21 is the better player");
    expect(cmp.verdict).toContain("P22 scores more");
  });

  it("gives no verdict for fewer than two known players", () => {
    expect(compareFreeAgents(ctx, ["21", "999"]).verdict).toBeNull();
  });
});

describe("evaluate a move", () => {
  it("reports deltas and a verdict", () => {
    const move = evaluateMove(ctx, 1, "11", "22")!;
    expect(move.delta.value).toBeCloseTo(1);
    expect(move.delta.ros).toBeCloseTo(-5);
    expect(move.verdict).toContain("keep P11");
    expect(move.warnings.some((w) => w.includes("healthy scratch"))).toBe(true);
  });

  it("warns on the goalie limit, injuries, and group changes", () => {
    const crowded: DecisionContext = {
      ...ctx,
      values: values([
        ...roster,
        pv(17, { rostered: true, fantasy_team_id: 1, group: "G", position: "G" }),
        pv(18, { rostered: true, fantasy_team_id: 1, group: "G", position: "G" }),
        ...agents,
      ]),
    };
    const warnings = evaluateMove(crowded, 1, "11", "24")!.warnings.join(" ");
    expect(warnings).toContain(`${MAX_GOALIES + 1} goalies`);
    expect(warnings).toContain("injured");
    expect(warnings).toContain("Different position group");
  });

  it("rejects a drop off the team or an add that is rostered", () => {
    expect(evaluateMove(ctx, 1, "31", "21")).toBeNull();
    expect(evaluateMove(ctx, 1, "11", "31")).toBeNull();
    expect(evaluateMove(ctx, null, "11", "21")).toBeNull();
  });
});

describe("weakest to best", () => {
  it("groups F/D/G ascending with a per-group max", () => {
    const groups = depthChart(ctx, 1);
    expect(groups.map((g) => g.group)).toEqual(["F", "D", "G"]);
    expect(groups[0]!.rows.map((r) => r.espnId)).toEqual(["13", "11", "12"]);
    expect(groups[0]!.max).toBe(4);
    expect(depthChart(ctx, 99)).toEqual([]);
  });
});

describe("formatDelta", () => {
  it("signs values with a true minus", () => {
    expect(formatDelta(0.4)).toBe("+0.40");
    expect(formatDelta(-1.25, 1)).toBe("−1.3");
    expect(formatDelta(null)).toBe("—");
  });
});
