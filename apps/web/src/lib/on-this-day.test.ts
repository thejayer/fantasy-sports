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

  it("counts years-ago from the synthetic week date when it spills into January", () => {
    // Sep 1 2024 + 18×7d ≈ early January 2025.
    let januaryPeriod = 0;
    let januaryWhen: Date | null = null;
    for (let period = 1; period <= 30; period++) {
      const when = new Date(digestPeriodMs(2024, period));
      if (when.getUTCFullYear() === 2025 && when.getUTCMonth() === 0) {
        januaryPeriod = period;
        januaryWhen = when;
        break;
      }
    }
    expect(januaryPeriod).toBeGreaterThan(0);
    expect(januaryWhen).not.toBeNull();

    const n = januaryPeriod;
    const league: LeagueSnapshot = {
      league_id: "football-main",
      espn_league_id: 1,
      sport: "football",
      format: "h2h",
      season: 2024,
      name: "Strictly Jayers Football",
      team_count: 2,
      current_week: n,
      teams: [
        {
          team_id: 1,
          name: "Alpha",
          abbrev: "ALP",
          owners: [],
          wins: n,
          losses: 0,
          ties: 0,
          points_for: 100,
          points_against: 80,
          standing: 1,
          division: "",
          schedule: Array.from({ length: n }, () => 2),
          scores: Array.from({ length: n }, () => 120),
          outcomes: Array.from({ length: n }, () => "W"),
          roster: [],
        },
        {
          team_id: 2,
          name: "Beta",
          abbrev: "BET",
          owners: [],
          wins: 0,
          losses: n,
          ties: 0,
          points_for: 80,
          points_against: 100,
          standing: 2,
          division: "",
          schedule: Array.from({ length: n }, () => 1),
          scores: Array.from({ length: n }, () => 90),
          outcomes: Array.from({ length: n }, () => "L"),
          roster: [],
        },
      ],
      players: [],
    };

    const now = new Date(
      Date.UTC(
        2026,
        januaryWhen!.getUTCMonth(),
        januaryWhen!.getUTCDate(),
        12,
      ),
    );
    // Season-year math would claim 2 years; calendar year of the week is 2025 → 1.
    expect(now.getUTCFullYear() - 2024).toBe(2);
    expect(now.getUTCFullYear() - januaryWhen!.getUTCFullYear()).toBe(1);

    const moments = collectOnThisDay(
      [{ archive: null, snapshots: [league] }],
      now,
    );
    const week = moments.find(
      (m) => m.kind === "week_recap" && m.id.endsWith(`:${januaryPeriod}`),
    );
    expect(week?.yearsAgo).toBe(1);
    expect(week?.title).toMatch(/1 year ago/);
    expect(week?.title).toContain("2025");
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
