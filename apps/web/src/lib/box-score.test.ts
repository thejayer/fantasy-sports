import { describe, expect, it } from "vitest";

import {
  boxPairKey,
  buildPlayerWeekGameLog,
  findBoxMatchup,
  formatBoxPoints,
  isStarterSlot,
  parseBoxPair,
  playerLinesInWeek,
  sortLineup,
} from "@/lib/box-score";
import type { WeekBoxScoreSnapshot } from "@/lib/data";

describe("box-score helpers (roadmap 8.1)", () => {
  it("parses and keys unordered team pairs", () => {
    expect(parseBoxPair("2-1")).toEqual({ a: 2, b: 1 });
    expect(parseBoxPair("nope")).toBeNull();
    expect(boxPairKey(4, 3)).toBe("3-4");
  });

  it("formats league points", () => {
    expect(formatBoxPoints(18.4)).toBe("18.4");
    expect(formatBoxPoints(null)).toBe("—");
  });

  it("sorts starters ahead of bench", () => {
    const ordered = sortLineup([
      {
        id: 1,
        name: "Bench",
        position: "WR",
        slot: "BE",
        points: 20,
      },
      {
        id: 2,
        name: "Starter",
        position: "RB",
        slot: "RB",
        points: 10,
      },
    ]);
    expect(ordered[0]?.name).toBe("Starter");
    expect(isStarterSlot("RB")).toBe(true);
    expect(isStarterSlot("BE")).toBe(false);
  });

  it("finds a matchup regardless of home/away order", () => {
    const snap = {
      schema_version: 1,
      league_id: "x",
      season: 2026,
      week: 1,
      sport: "football",
      matchups: [
        {
          home_team_id: 2,
          away_team_id: 1,
          home_score: 10,
          away_score: 8,
          home_lineup: [],
          away_lineup: [],
        },
      ],
    } as WeekBoxScoreSnapshot;
    expect(findBoxMatchup(snap, 1, 2)?.home_team_id).toBe(2);
    expect(findBoxMatchup(snap, 3, 4)).toBeNull();
  });

  it("builds a multi-week player log from week snapshots", () => {
    const w13 = {
      schema_version: 1,
      league_id: "x",
      season: 2026,
      week: 13,
      sport: "football",
      matchups: [
        {
          home_team_id: 1,
          away_team_id: 4,
          home_score: 90,
          away_score: 158,
          home_lineup: [
            {
              id: 202600001,
              name: "Juan Phillips",
              position: "QB",
              slot: "QB",
              points: 18.7,
              projected_points: 16.2,
            },
          ],
          away_lineup: [],
        },
      ],
    } as WeekBoxScoreSnapshot;
    const w14 = {
      ...w13,
      week: 14,
      matchups: [
        {
          home_team_id: 2,
          away_team_id: 1,
          home_score: 127.9,
          away_score: 103.2,
          home_lineup: [],
          away_lineup: [
            {
              id: "202600001",
              name: "Juan Phillips",
              position: "QB",
              slot: "QB",
              points: 12.3,
              projected_points: 11.1,
              pro_opponent: "FA",
            },
          ],
        },
      ],
    } as WeekBoxScoreSnapshot;

    expect(playerLinesInWeek(w14, 202600001)).toHaveLength(1);
    const log = buildPlayerWeekGameLog([w14, w13], 202600001);
    expect(log.rows.map((r) => r.week)).toEqual([13, 14]);
    expect(log.rows[0]?.points).toBe(18.7);
    expect(log.rows[1]?.opponentTeamId).toBe(2);
    expect(log.totalPoints).toBeCloseTo(31.0, 5);
    expect(log.avgPoints).toBeCloseTo(15.5, 5);
    expect(buildPlayerWeekGameLog([w13], 999).rows).toEqual([]);
  });
});
