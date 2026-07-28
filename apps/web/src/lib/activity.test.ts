import { describe, expect, it } from "vitest";

import type { Team, Transaction } from "@/lib/data";
import {
  activityRowsForLeague,
  classifyAction,
  formatActivityDate,
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
});
