import { describe, expect, it } from "vitest";

import type { Player } from "@/lib/data";
import {
  filterSlimPlayerRows,
  parsePlayerTableQuery,
  playersTableHref,
  queryPlayerTable,
  slimPlayerRow,
} from "@/lib/player-table";

function player(
  id: number,
  name: string,
  position: string,
  points: number,
  extras: Partial<Player> = {},
): Player {
  return {
    id,
    name,
    position,
    slot: position,
    pro_team: "NYY",
    injury_status: null,
    total_points: points,
    projected_total_points: null,
    avg_points: null,
    fantasy_team: "Alpha",
    season_stats: {
      R: id,
      HR: id,
      RBI: id,
      SB: 0,
      AVG: 0.3,
      OPS: 0.8,
      // unused fat fields should not appear on the slim row as nested objects
    },
    eligible_slots: ["C", "1B", "UTIL", "BE"],
    acquisition_type: "DRAFT",
    percent_owned: 99.9,
    ...extras,
  };
}

describe("player table (roadmap 7.11)", () => {
  it("slims rows to displayed fields only", () => {
    const slim = slimPlayerRow(player(1, "Test", "C", 12.5));
    expect(slim.name).toBe("Test");
    expect(slim.R).toBe(1);
    expect(slim).not.toHaveProperty("season_stats");
    expect(slim).not.toHaveProperty("eligible_slots");
    expect(slim).not.toHaveProperty("percent_owned");
  });

  it("filters, sorts, and paginates on the server", () => {
    const players = Array.from({ length: 60 }, (_, i) =>
      player(i + 1, `Player ${i + 1}`, i % 2 ? "P" : "C", 100 - i),
    );
    const result = queryPlayerTable(players, {
      q: "",
      pos: "C",
      sort: "fpts",
      dir: "desc",
      page: 2,
    });
    expect(result.filteredCount).toBe(30);
    expect(result.pageCount).toBe(2);
    expect(result.page).toBe(2);
    // Page 2 of 30 @ 25/page → 5 rows.
    expect(result.rows).toHaveLength(5);
    expect(result.rows[0].total_points).toBeGreaterThan(
      result.rows.at(-1)!.total_points ?? 0,
    );
  });

  it("applies search across name and teams", () => {
    const rows = [
      slimPlayerRow(player(1, "Aaron Judge", "OF", 10)),
      slimPlayerRow(player(2, "Other", "P", 5, { fantasy_team: "Judge Judy" })),
    ];
    expect(filterSlimPlayerRows(rows, { q: "judge", pos: null })).toHaveLength(
      2,
    );
  });

  it("parses query defaults and builds hrefs", () => {
    expect(parsePlayerTableQuery({}).sort).toBe("fpts");
    expect(parsePlayerTableQuery({ defaultSort: "vor" }).sort).toBe("vor");
    expect(
      playersTableHref("baseball-dynasty", 2026, {
        q: "judge",
        pos: "OF",
        sort: "HR",
        dir: "desc",
        page: 3,
      }),
    ).toContain("q=judge");
  });
});
