import { describe, expect, it } from "vitest";

import type { LeagueHistoryArchive } from "@/lib/data";
import {
  allTimeStandings,
  buildRecordBook,
  championsBySeason,
  defaultH2HPair,
  formatWinPct,
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
