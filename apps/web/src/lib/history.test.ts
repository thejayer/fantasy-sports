import { describe, expect, it } from "vitest";

import type { LeagueHistoryArchive } from "@/lib/data";
import {
  allTimeStandings,
  buildRecordBook,
  championsBySeason,
  defaultH2HPair,
  formatWinPct,
  franchiseCareer,
  headToHead,
  seasonCountLabel,
} from "@/lib/history";

function archive(): LeagueHistoryArchive {
  return {
    league_id: "football-main",
    name: "Main",
    sport: "football",
    format: "redraft",
    seasons: [
      {
        season: 2024,
        period_label: "week",
        teams: [
          {
            team_id: 1,
            name: "Alpha",
            abbrev: "ALP",
            owners: ["Ann"],
            wins: 10,
            losses: 4,
            ties: 0,
            points_for: 1400,
            points_against: 1200,
            standing: 1,
            schedule: [2, 2],
            scores: [120, 90],
            outcomes: ["W", "L"],
          },
          {
            team_id: 2,
            name: "Bravo",
            abbrev: "BRV",
            owners: ["Bob"],
            wins: 4,
            losses: 10,
            ties: 0,
            points_for: 1100,
            points_against: 1300,
            standing: 2,
            schedule: [1, 1],
            scores: [100, 110],
            outcomes: ["L", "W"],
          },
        ],
      },
      {
        season: 2025,
        period_label: "week",
        teams: [
          {
            team_id: 1,
            name: "Alpha FC",
            abbrev: "ALP",
            owners: ["Ann2"],
            wins: 8,
            losses: 6,
            ties: 0,
            points_for: 1300,
            points_against: 1250,
            standing: 2,
            schedule: [2],
            scores: [150],
            outcomes: ["W"],
          },
          {
            team_id: 2,
            name: "Bravo",
            abbrev: "BRV",
            owners: ["Bob2"],
            wins: 11,
            losses: 3,
            ties: 0,
            points_for: 1600,
            points_against: 1100,
            standing: 1,
            schedule: [1],
            scores: [80],
            outcomes: ["L"],
          },
        ],
      },
    ],
  };
}

describe("history aggregators", () => {
  it("builds all-time standings keyed by team_id", () => {
    const rows = allTimeStandings(archive());
    expect(rows).toHaveLength(2);
    expect(rows[0].teamId).toBe(1);
    expect(rows[0].wins).toBe(18);
    expect(rows[0].championships).toBe(1);
    expect(rows[0].name).toBe("Alpha FC");
    expect(rows[0].seasons).toBe(2);
    expect(formatWinPct(rows[0].winPct)).toBe(".643");
    expect(seasonCountLabel(archive())).toBe("2 seasons (2024–2025)");
  });

  it("lists champions by season", () => {
    const champs = championsBySeason(archive());
    expect(champs.map((c) => c.season)).toEqual([2025, 2024]);
    expect(champs[0].name).toBe("Bravo");
    expect(champs[1].teamId).toBe(1);
  });

  it("builds a record book from season and weekly scores", () => {
    const book = buildRecordBook(archive());
    const labels = book.map((e) => e.label);
    expect(labels).toContain("Most wins (season)");
    expect(labels).toContain("Most points (season)");
    expect(labels).toContain("Highest weekly score");
    expect(labels).toContain("Lowest weekly score");
    expect(labels).toContain("Most #1 finishes");
    const high = book.find((e) => e.label === "Highest weekly score");
    expect(high?.value).toBe("150");
    expect(high?.season).toBe(2025);
  });

  it("aggregates head-to-head without double counting", () => {
    const h2h = headToHead(archive(), 1, 2);
    expect(h2h.wins).toBe(2);
    expect(h2h.losses).toBe(1);
    expect(h2h.games).toHaveLength(3);
    expect(defaultH2HPair(archive())).toEqual({ a: 1, b: 2 });
  });
});

describe("franchiseCareer (roadmap 7.3)", () => {
  it("lists every season newest first with per-season high and low", () => {
    const career = franchiseCareer(archive(), 1)!;
    expect(career.seasons.map((s) => s.season)).toEqual([2025, 2024]);
    expect(career.seasons[0].name).toBe("Alpha FC");
    expect(career.seasons[0].high).toBe(150);
    expect(career.seasons[1].high).toBe(120);
    expect(career.seasons[1].low).toBe(90);
  });

  it("carries the latest identity, not the oldest", () => {
    const career = franchiseCareer(archive(), 1)!;
    expect(career.name).toBe("Alpha FC");
    expect(career.owners).toEqual(["Ann2"]);
  });

  it("reuses the all-time totals row", () => {
    const career = franchiseCareer(archive(), 1)!;
    expect(career.totals?.wins).toBe(18);
    expect(career.totals?.championships).toBe(1);
  });

  it("ranks rivals by games played", () => {
    const career = franchiseCareer(archive(), 1)!;
    expect(career.rivals).toHaveLength(1);
    expect(career.rivals[0].opponentId).toBe(2);
    expect(career.rivals[0].name).toBe("Bravo");
    expect(career.rivals[0].wins).toBe(2);
    expect(career.rivals[0].games).toHaveLength(3);
  });

  it("returns null for a franchise that never appears", () => {
    expect(franchiseCareer(archive(), 99)).toBeNull();
  });

  it("skips bye placeholders when finding a season high and low", () => {
    const withBye = archive();
    withBye.seasons[0].teams[0].schedule = [1, 2];
    withBye.seasons[0].teams[0].scores = [0, 90];
    const career = franchiseCareer(withBye, 1)!;
    const season2024 = career.seasons.find((s) => s.season === 2024)!;
    expect(season2024.low).toBe(90);
  });
});
