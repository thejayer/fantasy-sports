import { describe, expect, it } from "vitest";

import {
  SLOT_COLUMNS,
  analysisFreshness,
  buildChartModel,
  reanchorTimeseries,
  deriveBats,
  derivePitchers,
  isoWeekKey,
  linePath,
  parseAnalysisSeriesMode,
  rollupWeekly,
  slotTableRows,
  slotColumnsFor,
  type SlotPointsSnapshot,
  type PointsTimeseriesSnapshot,
} from "@/lib/baseball-analysis";

const slotSnap = (): SlotPointsSnapshot => ({
  schema_version: 1,
  league_id: "baseball-dynasty",
  season: 2026,
  sport: "baseball",
  scoring_type: "TOTAL_SEASON_POINTS",
  teams: [
    {
      team_id: 4,
      name: "Okiro",
      slots: {
        C: 487,
        "1B": 412,
        "2B": 444,
        "3B": 424,
        SS: 450,
        OF: 1308,
        DH: 448,
        UTIL: 382,
        P: 3555,
        RP: 450,
      },
      starters: 8360,
      bench_il: 1465,
      espn_points: 8443,
      delta: -83,
    },
  ],
});

describe("parseAnalysisSeriesMode", () => {
  it("defaults to cumulative", () => {
    expect(parseAnalysisSeriesMode(undefined)).toBe("cumulative");
    expect(parseAnalysisSeriesMode("nope")).toBe("cumulative");
    expect(parseAnalysisSeriesMode("daily")).toBe("daily");
    expect(parseAnalysisSeriesMode("weekly")).toBe("weekly");
  });
});

describe("slot table derivation", () => {
  it("rebuilds bats and pitchers from slot columns", () => {
    const rows = slotTableRows(slotSnap());
    expect(rows).toHaveLength(1);
    expect(deriveBats(rows[0])).toBe(4355);
    expect(derivePitchers(rows[0])).toBe(4005);
    expect(rows[0].bats + rows[0].pitchers).toBe(8360);
    expect(SLOT_COLUMNS).toContain("UTIL");
  });

  it("derives hockey skaters and goalies from Forward/Defense/Util vs Goalie", () => {
    const snap: SlotPointsSnapshot = {
      schema_version: 1,
      league_id: "hockey-main",
      season: 2027,
      sport: "hockey",
      scoring_type: "TOTAL_SEASON_POINTS",
      slots: ["Forward", "Defense", "Goalie", "Util"],
      teams: [
        {
          team_id: 1,
          name: "Five Hole Heroes",
          slots: { Forward: 100, Defense: 50, Goalie: 40, Util: 20 },
          starters: 210,
          bench_il: 30,
          espn_points: 215,
          delta: -5,
        },
      ],
    };
    const rows = slotTableRows(snap);
    expect(rows[0].skaters).toBe(170);
    expect(rows[0].goalies).toBe(40);
    expect(slotColumnsFor(snap)).toEqual([
      "Forward",
      "Defense",
      "Goalie",
      "Util",
    ]);
  });

  it("returns empty when analysis is missing", () => {
    expect(slotTableRows(null)).toEqual([]);
  });
});

describe("weekly rollup + chart", () => {
  const series: PointsTimeseriesSnapshot = {
    schema_version: 1,
    league_id: "baseball-dynasty",
    season: 2026,
    sport: "baseball",
    teams: [
      {
        team_id: 1,
        name: "Solo",
        points: [
          {
            period: 1,
            date: "2026-03-26",
            daily_starters: 10,
            cumulative_starters: 10,
            daily_bats: 6,
            daily_pitchers: 4,
          },
          {
            period: 2,
            date: "2026-03-27",
            daily_starters: 5,
            cumulative_starters: 15,
            daily_bats: 2,
            daily_pitchers: 3,
          },
          {
            period: 8,
            date: "2026-04-02",
            daily_starters: 7,
            cumulative_starters: 22,
            daily_bats: 3,
            daily_pitchers: 4,
          },
        ],
      },
    ],
  };

  it("groups calendar days into ISO weeks", () => {
    expect(isoWeekKey("2026-03-26", 1)).toBe("2026-W13");
    expect(isoWeekKey("2026-04-02", 8)).toBe("2026-W14");
    const weekly = rollupWeekly(series.teams[0].points);
    expect(weekly).toHaveLength(2);
    expect(weekly[0].daily_starters).toBe(15);
    expect(weekly[0].cumulative_starters).toBe(15);
    expect(weekly[1].daily_starters).toBe(7);
  });

  it("builds a cumulative chart with month ticks", () => {
    const model = buildChartModel(series, "cumulative");
    expect(model).not.toBeNull();
    expect(model!.lines).toHaveLength(1);
    expect(model!.lines[0].points.at(-1)?.y).toBe(22);
    expect(model!.xTicks.some((tick) => /Mar|Apr|P1/.test(tick.label))).toBe(
      true,
    );
    expect(linePath(model!.lines[0].points, 100, 50, model!.yMax)).toMatch(/^M/);
  });

  it("returns null without timeseries", () => {
    expect(buildChartModel(null, "cumulative")).toBeNull();
  });
});

describe("hockey analysis freshness (stale / future-dated sidecars)", () => {
  const hockeySeries = (): PointsTimeseriesSnapshot => ({
    schema_version: 1,
    league_id: "hockey-main",
    season: 2027,
    sport: "hockey",
    // Sync on Sun 2026-10-18 (Eastern); period 15 is "today".
    synced_at: "2026-10-18T16:00:00+00:00",
    teams: [
      {
        team_id: 1,
        name: "Solo",
        // Old file: dated from a hardcoded Oct 7 opening night, so period 15
        // lands on Oct 21 — three days after the sync.
        points: [1, 14, 15].map((period) => ({
          period,
          date: `2026-10-${String(6 + period).padStart(2, "0")}`,
          daily_starters: 10,
          cumulative_starters: period * 10,
        })),
      },
    ],
  });

  it("re-dates a series that runs past its sync day", () => {
    const fixed = reanchorTimeseries(hockeySeries())!;
    expect(fixed.teams[0].points.map((p) => p.date)).toEqual([
      "2026-10-04",
      "2026-10-17",
      "2026-10-18",
    ]);
    const model = buildChartModel(hockeySeries(), "cumulative")!;
    expect(model.lines[0].points.at(-1)?.label).toBe("2026-10-18");
  });

  it("trusts files that carry a date_anchor and finished seasons", () => {
    const anchored = { ...hockeySeries(), date_anchor: { period: 15, date: "2026-10-18" } };
    expect(reanchorTimeseries(anchored)).toBe(anchored);
    const done = hockeySeries();
    done.synced_at = "2027-05-01T12:00:00+00:00";
    expect(reanchorTimeseries(done)).toBe(done);
  });

  it("flags starters that trail ESPN points_for", () => {
    const team = (starters: number, espn: number) => ({
      team_id: 1,
      name: "t",
      slots: {},
      starters,
      bench_il: 0,
      espn_points: espn,
      delta: starters - espn,
    });
    const behind = analysisFreshness({
      ...slotSnap(),
      sport: "hockey",
      synced_at: "2026-10-18T16:00:00+00:00",
      teams: [team(800, 1000), team(780, 1000)],
    });
    expect(behind.behind).toBe(true);
    expect(behind.coverage).toBeCloseTo(0.79);
    expect(behind.asOf).toBe("2026-10-18");
    expect(
      analysisFreshness({ ...slotSnap(), teams: [team(995, 1000)] }).behind,
    ).toBe(false);
    expect(analysisFreshness(null).coverage).toBeNull();
  });
});
