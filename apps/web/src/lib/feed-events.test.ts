import { describe, expect, it } from "vitest";

import type { LeagueSnapshot, Team } from "@/lib/data";
import { systemFeedEvents } from "@/lib/feed-events";

function team(
  id: number,
  name: string,
  schedule: number[],
  scores: number[],
  outcomes: string[],
): Team {
  return {
    team_id: id,
    name,
    abbrev: name.slice(0, 3).toUpperCase(),
    owners: [],
    wins: outcomes.filter((o) => o === "W").length,
    losses: outcomes.filter((o) => o === "L").length,
    ties: 0,
    points_for: scores.reduce((a, b) => a + b, 0),
    points_against: 0,
    standing: id,
    division: "",
    schedule,
    scores,
    outcomes,
    roster: [],
  };
}

const league: LeagueSnapshot = {
  schema_version: 1,
  league_id: "football-main",
  espn_league_id: 1,
  name: "Main",
  season: 2026,
  sport: "football",
  format: "redraft",
  team_count: 2,
  current_week: 2,
  synced_at: "2026-09-20T00:00:00Z",
  teams: [
    team(1, "Alpha", [2, 2], [100, 90], ["W", "L"]),
    team(2, "Beta", [1, 1], [80, 110], ["L", "W"]),
  ],
  players: [],
  draft: [
    {
      round: 1,
      round_pick: 1,
      team_id: 1,
      player_id: 99,
      player_name: "Star RB",
      bid_amount: 0,
      keeper: false,
      nominating_team_id: null,
    },
  ],
  transactions: [
    {
      date: "20260901120000",
      actions: [
        {
          team_id: 1,
          action: "FA ADDED",
          player_id: 10,
          player_name: "Wire Guy",
          bid_amount: 5,
        },
      ],
    },
    {
      date: "20260905180000",
      actions: [
        {
          team_id: 1,
          action: "TRADED",
          player_id: 11,
          player_name: "Trade Piece",
          bid_amount: 0,
        },
        {
          team_id: 2,
          action: "TRADED",
          player_id: 12,
          player_name: "Other Piece",
          bid_amount: 0,
        },
      ],
    },
  ],
};

describe("systemFeedEvents (roadmap 7.6)", () => {
  it("merges trades, waivers, draft, and results newest-first", () => {
    const events = systemFeedEvents(league, "all");
    const kinds = new Set(events.map((e) => e.kind));
    expect(kinds.has("trade")).toBe(true);
    expect(kinds.has("waiver")).toBe(true);
    expect(kinds.has("draft")).toBe(true);
    expect(kinds.has("result")).toBe(true);
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].sortKey).toBeGreaterThanOrEqual(events[i].sortKey);
    }
  });

  it("filters by kind", () => {
    expect(systemFeedEvents(league, "trades").every((e) => e.kind === "trade")).toBe(
      true,
    );
    expect(
      systemFeedEvents(league, "results").every((e) => e.kind === "result"),
    ).toBe(true);
  });

  it("uses stable ids for comment targeting", () => {
    const a = systemFeedEvents(league, "all");
    const b = systemFeedEvents(league, "all");
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
  });
});
