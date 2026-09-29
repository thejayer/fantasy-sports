import { describe, expect, it } from "vitest";

import type { SlotPointsSnapshot } from "@/lib/baseball-analysis";
import type { LeagueSnapshot } from "@/lib/data";
import {
  B2B_FACTOR,
  OT_SHARE,
  dailyLineup,
  dayPlayer,
  fillLineup,
  gameOn,
  goalieBoard,
  goalieGame,
  leagueSlots,
  leagueWeights,
  paceTable,
  parseDate,
  startOdds,
  streamingPlan,
  windowDates,
  type DailyContext,
  type HockeyTeamStrengthSnapshot,
} from "@/lib/hockey-daily";
import { decisionRow, type HockeyScheduleSnapshot } from "@/lib/hockey-decisions";
import type { HockeyBio } from "@/lib/hockey-nhl";
import type { HockeyPlayerValue, HockeyValuesSnapshot } from "@/lib/hockey-values";

function pv(id: number, partial: Partial<HockeyPlayerValue>): HockeyPlayerValue {
  return {
    espn_id: id,
    name: `P${id}`,
    position: "C",
    group: "F",
    pro_team: "BOS",
    nhl_id: id,
    nhl_team: "BOS",
    fantasy_team_id: 1,
    rostered: true,
    injury_status: "ACTIVE",
    age: 25,
    value: 3,
    base: 3,
    mult: 1,
    adjustments: [],
    parts: [],
    source: "full",
    durability: { rate: 1, basis: "t", iron_man: false },
    remaining_games: 10,
    ros: 30,
    espn_proj: null,
    ...partial,
  } as HockeyPlayerValue;
}

function bio(nhlId: number, team: string, partial: Partial<HockeyBio> = {}): HockeyBio {
  return {
    nhlId,
    age: 25,
    heightIn: 72,
    weightLb: 190,
    team,
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

const DAY = "2026-10-10";

const schedule: HockeyScheduleSnapshot = {
  league_id: "hockey-main",
  season: 2027,
  sport: "hockey",
  teams: {
    BOS: [{ date: DAY, opp: "TOR", home: true }],
    TOR: [{ date: DAY, opp: "BOS", home: false, b2b: true }],
    MTL: [{ date: "2026-10-11", opp: "OTT", home: true }],
  },
};

// Even clubs: 3 GF / 3 GA, 30 shots each way (league average).
const strength: HockeyTeamStrengthSnapshot = {
  league_id: "hockey-main",
  season: 2027,
  league_avg: { gf: 3, ga: 3, sf: 30, sa: 30 },
  teams: {
    BOS: { gf: 3, ga: 3, sf: 30, sa: 30 },
    TOR: { gf: 3.6, ga: 2.4, sf: 33, sa: 27 },
  },
};

const weights = { W: 4, L: -2, GA: -2, SV: 0.35, SO: 3 };

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

// Team 1 at BOS / TOR / MTL. Goalies 50 (BOS starter) and 51 (TOR backup).
const roster = [
  pv(1, { value: 4 }),
  pv(2, { value: 3, nhl_team: "TOR", durability: { rate: 0.5, basis: "t", iron_man: false } }),
  pv(3, { value: 5, nhl_team: "MTL" }), // no game on DAY
  pv(4, { value: 2.5, group: "D", position: "D" }),
  pv(5, { value: 1, injury_status: "OUT" }),
  pv(6, { value: 2 }), // on IR
  pv(50, { group: "G", position: "G", value: 4, durability: { rate: 0.7, basis: "t", iron_man: false } }),
  pv(51, {
    group: "G",
    position: "G",
    value: 3,
    nhl_team: "TOR",
    durability: { rate: 0.3, basis: "t", iron_man: false },
  }),
];
const agents = [
  pv(20, { rostered: false, fantasy_team_id: null, value: 3.2 }),
  pv(21, { rostered: false, fantasy_team_id: null, value: 2.2, group: "D", position: "D", nhl_team: "TOR" }),
  pv(22, { rostered: false, fantasy_team_id: null, value: 9, nhl_team: "MTL" }),
];

function ctx(partial: Partial<DailyContext> = {}): DailyContext {
  return {
    values: values([...roster, ...agents]),
    bios: { "50": bio(50, "BOS", { role: "G1" }), "51": bio(51, "TOR"), "52": bio(52, "TOR") },
    schedule,
    start: DAY,
    strength,
    lines: null,
    weights,
    slots: { F: 2, D: 2, G: 2, UTIL: 1 },
    irIds: new Set(["6"]),
    ...partial,
  };
}

describe("inputs", () => {
  it("parses dates and builds a 7-day window", () => {
    expect(parseDate("2026-10-10")).toBe("2026-10-10");
    expect(parseDate("10/10/2026")).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(windowDates("2026-10-30", 3)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  it("reads weights and slot counts from ESPN settings", () => {
    const league = {
      settings: {
        scoring_format: [{ abbr: "W", points: 4 }, { abbr: "SV", points: 0.35 }],
        position_slot_counts: { F: 9, D: 5, G: 2, UTIL: 1, BE: 7 },
      },
      teams: [],
    } as unknown as LeagueSnapshot;
    expect(leagueWeights(league)).toEqual({ W: 4, SV: 0.35 });
    expect(leagueSlots(league)).toEqual({ F: 9, D: 5, G: 2, UTIL: 1 });
  });

  it("finds a club's game on a date", () => {
    expect(gameOn("TOR", schedule, DAY)).toEqual({ opp: "BOS", home: false, b2b: true });
    expect(gameOn("MTL", schedule, DAY)).toBeNull();
  });
});

describe("goalie start model", () => {
  it("scores an even matchup with the league's weights", () => {
    const g = goalieGame("BOS", "BOS", strength, weights)!;
    expect(g.win).toBeCloseTo(0.5);
    expect(g.goalsAgainst).toBeCloseTo(3);
    expect(g.shotsAgainst).toBeCloseTo(30);
    expect(g.saves).toBeCloseTo(27);
    expect(g.shutout).toBeCloseTo(Math.exp(-3));
    expect(g.loss).toBeCloseTo(0.5 * (1 - OT_SHARE));
    const expected = 4 * 0.5 - 2 * g.loss - 2 * 3 + 0.35 * 27 + 3 * Math.exp(-3);
    expect(g.pointsIfStart).toBeCloseTo(expected);
  });

  it("favours the stronger club", () => {
    const bos = goalieGame("BOS", "TOR", strength, weights)!;
    const tor = goalieGame("TOR", "BOS", strength, weights)!;
    expect(tor.win).toBeGreaterThan(0.5);
    expect(bos.win).toBeCloseTo(1 - tor.win);
    expect(tor.pointsIfStart).toBeGreaterThan(bos.pointsIfStart);
  });

  it("needs both clubs and a league average", () => {
    expect(goalieGame("BOS", "XXX", strength, weights)).toBeNull();
    expect(goalieGame("BOS", "TOR", null, weights)).toBeNull();
  });
});

describe("start odds", () => {
  const c = ctx();
  const row = (id: string) => decisionRow(id, c.values!.players[id]!, c.bios, c.schedule, c.start);

  it("uses the share of starts, with the back-to-back rule", () => {
    expect(startOdds(row("50"), DAY, c, false).p).toBeCloseTo(0.7);
    expect(startOdds(row("50"), DAY, c, true).p).toBeCloseTo(0.7 * B2B_FACTOR);
    // The backup picks up the rest on a back-to-back.
    expect(startOdds(row("51"), DAY, c, true).p).toBeCloseTo(1 - B2B_FACTOR * 0.7);
  });

  it("prefers Daily Faceoff, for the goalie or a partner", () => {
    const named = ctx({
      lines: {
        goalie_starts: { "52": { [DAY]: { status: "Confirmed", opp: "BOS", home: false } } },
      } as unknown as DailyContext["lines"],
    });
    const odds = startOdds(row("51"), DAY, named, true);
    expect(odds.p).toBe(0);
    expect(odds.basis).toContain("Partner");
    const mine = ctx({
      lines: {
        goalie_starts: { "51": { [DAY]: { status: "Likely", opp: "BOS", home: false } } },
      } as unknown as DailyContext["lines"],
    });
    expect(startOdds(row("51"), DAY, mine, true).p).toBeCloseTo(0.8);
  });
});

describe("daily start / sit", () => {
  it("starts the best players with games and explains the rest", () => {
    const lineup = dailyLineup(ctx(), 1, DAY);
    const bySlot = (slot: string) =>
      lineup.starters.filter((s) => s.slot === slot).map((s) => s.player?.row.espnId ?? null);
    // F: P1 (4.0) and P2 (3 × 0.5 = 1.5); UTIL: nobody left with a game.
    expect(bySlot("F")).toEqual(["1", "2"]);
    expect(bySlot("D")).toEqual(["4", null]);
    expect(bySlot("UTIL")).toEqual([null]);
    expect(lineup.open).toEqual({ F: 0, D: 1, G: 0, UTIL: 1 });
    const why = Object.fromEntries(lineup.bench.map((p) => [p.row.espnId, p.note]));
    expect(why["3"]).toBe("No game");
    expect(why["5"]).toBe("Injured");
    expect(why["6"]).toBe("On IR");
    expect(lineup.total).toBeGreaterThan(0);
  });

  it("gives UTIL the best skater left over", () => {
    const c = ctx({ slots: { F: 1, D: 1, G: 0, UTIL: 1 } });
    const lineup = dailyLineup(c, 1, DAY);
    expect(lineup.starters.find((s) => s.slot === "UTIL")?.player?.row.espnId).toBe("2");
  });

  it("never starts a player at zero", () => {
    const c = ctx();
    const pool = [dayPlayer(decisionRow("3", c.values!.players["3"]!, c.bios, schedule, DAY), DAY, c)];
    expect(fillLineup(pool, c.slots, DAY).open.F).toBe(2);
  });

  it("halves a possible scratch", () => {
    const c = ctx({ bios: { "1": bio(1, "BOS", { possibleScratch: true }) } });
    const p = dayPlayer(decisionRow("1", c.values!.players["1"]!, c.bios, schedule, DAY), DAY, c);
    expect(p.expected).toBeCloseTo(2);
    expect(p.note).toBe("Possible scratch");
  });
});

describe("goalie board + streaming", () => {
  it("lists goalies with a game, owned or free", () => {
    const rows = goalieBoard(ctx(), DAY);
    expect(rows.map((r) => r.row.espnId).sort()).toEqual(["50", "51"]);
    expect(rows[0]!.expected).toBeGreaterThanOrEqual(rows[1]!.expected);
  });

  it("fills open slots with free agents who play that day", () => {
    const plan = streamingPlan(ctx(), 1, [DAY, "2026-10-11"]);
    expect(plan.days[0]!.adds.map((a) => [a.player.row.espnId, a.slot])).toEqual([
      ["20", "UTIL"],
      ["21", "D"],
    ]);
    // Oct 11: only MTL plays → P22 fills an F slot (F is empty that day).
    expect(plan.days[1]!.adds[0]!.player.row.espnId).toBe("22");
    expect(plan.week[0]!.row.espnId).toBe("22");
  });
});

describe("GP cap pacing", () => {
  const league = {
    settings: {
      lineup_slot_stat_limits: [
        { slot: "F", stat: "GP", limit: 855 },
        { slot: "G", stat: "GP", limit: 164 },
      ],
    },
    teams: [],
  } as unknown as LeagueSnapshot;
  const slotPoints = {
    periods: { latest: 95, final: 190 },
    teams: [{ team_id: 1, games: { Forward: 500, Goalie: 60 } }],
  } as unknown as SlotPointsSnapshot;

  it("projects each capped slot from games used and the season elapsed", () => {
    const t = paceTable(slotPoints, league, schedule, 1)!;
    expect(t.elapsedDays).toBe(95);
    expect(t.seasonDays).toBe(190);
    const f = t.rows.find((r) => r.slot === "F")!;
    expect(f.pace).toBeCloseTo(427.5);
    expect(f.projected).toBeCloseTo(1000);
    expect(f.status).toBe("over");
    expect(f.perDayLeft).toBeCloseTo(355 / 95);
    expect(t.rows.find((r) => r.slot === "G")!.status).toBe("under");
    expect(t.rows.map((r) => r.slot)).toEqual(["F", "G"]); // no cap → no row
  });

  it("falls back to the schedule span only when it covers the days counted", () => {
    const noFinal = { ...slotPoints, periods: { latest: 1 } } as SlotPointsSnapshot;
    expect(paceTable(noFinal, league, schedule, 1)!.seasonDays).toBe(2);
    const late = { ...slotPoints, periods: { latest: 30 } } as SlotPointsSnapshot;
    expect(paceTable(late, league, schedule, 1)).toBeNull();
  });

  it("is empty without game counts", () => {
    const bare = { ...slotPoints, teams: [{ team_id: 1 }] } as unknown as SlotPointsSnapshot;
    expect(paceTable(bare, league, schedule, 1)).toBeNull();
    expect(paceTable(null, league, schedule, 1)).toBeNull();
  });
});
