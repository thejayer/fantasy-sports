import { describe, expect, it } from "vitest";

import type { LeagueSnapshot } from "./data";
import { buildGolfSnapshot } from "./golf";
import { buildGolferProfileBoard, leagueOwnershipPct } from "./golf-player";
import { buildGolfUsageBoard } from "./golf-usage";

describe("golf player / usage (roadmap 8.3)", () => {
  const snap = buildGolfSnapshot({
    league_id: "golf-p",
    name: "P",
    season: 2026,
    format: "h2h",
    team_count: 6,
    bench: 10,
    missed_cut: "alt1",
    draft_style: "snake",
    keepers: false,
    multipliers: { regular: 1, signature: 1.5, major: 2 },
  }) as unknown as LeagueSnapshot;

  it("reports ownership and lineup usage for a rostered golfer", () => {
    const team = snap.teams[0]!;
    const player = team.roster[0]!;
    const { pct, teams } = leagueOwnershipPct(snap, player.id!);
    expect(pct).toBeCloseTo(100 / 6, 5);
    expect(teams).toHaveLength(1);

    const board = buildGolferProfileBoard(snap, player, team);
    expect(board.starts.length).toBeGreaterThan(0);
    expect(board.results.length).toBeGreaterThan(0);
    expect(board.disclaimer).toMatch(/lineups \+ EOD/);
  });

  it("builds a segment start usage board", () => {
    const usage = buildGolfUsageBoard(snap);
    expect(usage.maxPerSegment).toBe(3);
    expect(usage.segments).toContain("early");
    expect(usage.rows.length).toBeGreaterThan(0);
    expect(usage.rows[0]?.used).toBeGreaterThan(0);
  });
});
