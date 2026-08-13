import { describe, expect, it } from "vitest";

import type { Team, Transaction } from "@/lib/data";
import {
  activityRowsForLeague,
  classifyAction,
  droppedPlayersForTeam,
  droppedRowsForTeam,
  formatActivityDate,
  isDropAction,
  parseEspnActivityDate,
} from "@/lib/activity";

const teams: Team[] = [
  {
    team_id: 1,
    name: "Alpha",
    abbrev: "ALP",
    owners: [],
    wins: 0,
    losses: 0,
    ties: 0,
    points_for: 0,
    points_against: 0,
    standing: 1,
    division: "",
    roster: [],
  },
];

const transactions: Transaction[] = [
  {
    date: "20260901120000",
    actions: [
      {
        team_id: 1,
        action: "FA ADDED",
        player_id: 10,
        player_name: "Wire Guy",
        bid_amount: 12,
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
    ],
  },
];

describe("activity helpers", () => {
  it("parses ESPN YYYYMMDDHHmmss dates", () => {
    const date = parseEspnActivityDate("20260901120000");
    expect(date?.getUTCFullYear()).toBe(2026);
    expect(date?.getUTCMonth()).toBe(8);
    expect(date?.getUTCDate()).toBe(1);
    expect(formatActivityDate("20260901120000")).toMatch(/2026/);
  });

  it("classifies trade vs waiver actions", () => {
    expect(classifyAction("TRADED")).toBe("trade");
    expect(classifyAction("FA ADDED")).toBe("waiver");
    expect(classifyAction("DROPPED")).toBe("waiver");
    expect(classifyAction("MOVED")).toBe("other");
  });

  it("detects ESPN drop action strings", () => {
    expect(isDropAction("DROPPED")).toBe(true);
    expect(isDropAction("WAIVER DROPPED")).toBe(true);
    expect(isDropAction("FA ADDED")).toBe(false);
    expect(isDropAction("TRADED")).toBe(false);
  });

  it("flattens and filters league transactions newest-first", () => {
    const all = activityRowsForLeague({ transactions, teams }, "all");
    expect(all).toHaveLength(2);
    expect(all[0].playerName).toBe("Trade Piece");
    expect(all[0].teamName).toBe("Alpha");
    expect(activityRowsForLeague({ transactions, teams }, "trades")).toHaveLength(
      1,
    );
    expect(
      activityRowsForLeague({ transactions, teams }, "waivers"),
    ).toHaveLength(1);
  });

  it("lists unique players a manager dropped this season", () => {
    const withDrops: Transaction[] = [
      ...transactions,
      {
        date: "20260910120000",
        actions: [
          {
            team_id: 1,
            action: "DROPPED",
            player_id: 12,
            player_name: "First Cut",
            bid_amount: 0,
          },
        ],
      },
      {
        date: "20260920120000",
        actions: [
          {
            team_id: 1,
            action: "WAIVER DROPPED",
            player_id: 12,
            player_name: "First Cut",
            bid_amount: 0,
          },
        ],
      },
      {
        date: "20260915120000",
        actions: [
          {
            team_id: 2,
            action: "DROPPED",
            player_id: 99,
            player_name: "Other Team",
            bid_amount: 0,
          },
        ],
      },
    ];
    const league = { transactions: withDrops, teams };
    expect(droppedRowsForTeam(league, 1)).toHaveLength(2);
    const unique = droppedPlayersForTeam(league, 1);
    expect(unique).toHaveLength(1);
    expect(unique[0].playerName).toBe("First Cut");
    expect(unique[0].dropCount).toBe(2);
    expect(unique[0].lastDateLabel).toMatch(/2026/);
    expect(droppedPlayersForTeam(league, 2)).toHaveLength(1);
    expect(droppedPlayersForTeam(league, 2)[0].playerName).toBe("Other Team");
  });
});
