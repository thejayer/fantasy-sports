import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import type { LeagueHistoryArchive, LeagueSnapshot } from "@/lib/data";
import { digestPeriodMs } from "@/lib/digest";
import {
  collectOnThisDay,
  formatMonthDay,
  onThisDayClock,
  sameUtcMonthDay,
  snapshotFromHistorySlice,
} from "@/lib/on-this-day";

const FIXTURES = path.resolve(process.cwd(), "../../fixtures/sj");

function loadFootballMain(): LeagueSnapshot {
  return JSON.parse(
    readFileSync(path.join(FIXTURES, "football-main", "2026.json"), "utf8"),
  ) as LeagueSnapshot;
}

describe("on-this-day", () => {
  it("matches UTC month/day and formats labels", () => {
    const a = new Date(Date.UTC(2024, 8, 8, 15));
    const b = new Date(Date.UTC(2026, 8, 8, 1));
    expect(sameUtcMonthDay(a, b)).toBe(true);
    expect(sameUtcMonthDay(a, new Date(Date.UTC(2026, 8, 9)))).toBe(false);
    expect(formatMonthDay(a)).toBe("Sep 8");
  });

  it("honors SJ_ON_THIS_DAY_NOW for a frozen clock", () => {
    const prev = process.env.SJ_ON_THIS_DAY_NOW;
    process.env.SJ_ON_THIS_DAY_NOW = "2026-09-08T12:00:00.000Z";
    try {
      expect(onThisDayClock().toISOString()).toBe("2026-09-08T12:00:00.000Z");
    } finally {
      if (prev === undefined) delete process.env.SJ_ON_THIS_DAY_NOW;
      else process.env.SJ_ON_THIS_DAY_NOW = prev;
    }
  });

  it("surfaces week-1 football recap on the synthetic Sep 8 anniversary", () => {
    const league = loadFootballMain();
    // period 1 → Sep 1 + 7d = Sep 8
    expect(new Date(digestPeriodMs(2026, 1)).getUTCDate()).toBe(8);

    const moments = collectOnThisDay(
      [{ archive: null, snapshots: [league] }],
      new Date("2026-09-08T12:00:00.000Z"),
    );
    expect(moments.some((m) => m.kind === "week_recap")).toBe(true);
    const week = moments.find((m) => m.id.includes(":1"));
    expect(week?.title).toMatch(/Week 1/);
    expect(week?.href).toContain("tab=matchups&week=1");
    expect(week?.detail).toMatch(/Highest score|blowout|Closest/i);
  });

  it("labels prior-year weeks as years ago via history archive", () => {
    const league = loadFootballMain();
    const archive: LeagueHistoryArchive = {
      league_id: league.league_id,
      name: league.name,
      sport: league.sport,
      format: league.format,
      seasons: [
        {
          season: 2024,
          teams: league.teams.map((t) => ({
            team_id: t.team_id,
            name: t.name,
            abbrev: t.abbrev,
            owners: t.owners ?? [],
            wins: t.wins ?? 0,
            losses: t.losses ?? 0,
            ties: t.ties ?? 0,
            points_for: t.points_for ?? null,
            points_against: t.points_against ?? null,
            standing: t.standing ?? null,
            schedule: t.schedule ?? [],
            scores: t.scores ?? [],
            outcomes: t.outcomes ?? [],
          })),
        },
      ],
    };
    const sliceSnap = snapshotFromHistorySlice(archive, archive.seasons[0]!);
    expect(sliceSnap.teams[0]?.roster).toEqual([]);

    const moments = collectOnThisDay(
      [{ archive, snapshots: [] }],
      new Date("2026-09-08T12:00:00.000Z"),
    );
    const week = moments.find((m) => m.kind === "week_recap");
    expect(week?.yearsAgo).toBe(2);
    expect(week?.title).toMatch(/2 years ago/);
  });

  it("matches Sep 1 transaction anniversaries from fixtures", () => {
    const league = loadFootballMain();
    const moments = collectOnThisDay(
      [{ archive: null, snapshots: [league] }],
      new Date("2026-09-01T12:00:00.000Z"),
    );
    expect(moments.some((m) => m.kind === "transaction")).toBe(true);
  });
});
