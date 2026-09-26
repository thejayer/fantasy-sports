import { describe, expect, it } from "vitest";

import {
  SLOT_COLUMNS,
  buildChartModel,
  deriveBats,
  derivePitchers,
  isoWeekKey,
  linePath,
  parseAnalysisSeriesMode,
  rollupWeekly,
  slotTableRows,
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
