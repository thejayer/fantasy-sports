import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { LeagueSnapshot, Player, Team, Transaction } from "@/lib/data";
import { buildWorstDropsBoard, formatDropDate } from "@/lib/worst-drops";

const FIXTURES = path.resolve(process.cwd(), "../../fixtures/sj");

function player(partial: Partial<Player>): Player {
  return {
    id: 1,
    name: "Test",
    position: "OF",
    slot: "OF",
    pro_team: "NYY",
    injury_status: null,
    total_points: 0,
    projected_total_points: null,
    avg_points: null,
    ...partial,
  };
}

function team(partial: Partial<Team>): Team {
  return {
    team_id: 1,
    name: "Alpha",
    abbrev: "ALP",
    owners: ["Ada"],
    wins: 0,
    losses: 0,
    ties: 0,
    points_for: 0,
    points_against: 0,
    standing: 1,
    division: "",
    roster: [],
    ...partial,
  };
}

function league(
  partial: Partial<LeagueSnapshot> &
    Pick<LeagueSnapshot, "transactions" | "teams">,
): LeagueSnapshot {
  return {
    league_id: "baseball-dynasty",
    espn_league_id: 2499137,
    sport: "baseball",
    format: "dynasty",
    season: 2026,
    name: "Test",
    team_count: partial.teams.length,
    current_week: 1,
    players: [],
    free_agents: [],
    ...partial,
  };
}

function tx(
  date: string,
  actions: Transaction["actions"],
): Transaction {
  return { date, actions };
}

describe("worst drops (roadmap 9.5)", () => {
  it("formats valid ESPN dates and falls back to year–month", () => {
    expect(formatDropDate("20260401120000")).toMatch(/2026/);
    expect(formatDropDate("20260987400000")).toMatch(/2026/);
    expect(formatDropDate("20260987400000")).not.toBe("20260987400000");
  });

  it("returns an empty board when transactions are missing", () => {
    const board = buildWorstDropsBoard(
      league({ transactions: [], teams: [team({ team_id: 1 })] }),
    );
    expect(board.hasTransactions).toBe(false);
    expect(board.rows).toEqual([]);
    expect(board.disclaimer).toMatch(/Season FP is the cut player's current ESPN-applied season total/);
  });

  it("ignores trades and ranks the first drop per team–player by season FP", () => {
    const star = player({ id: 10, name: "Star", total_points: 400 });
    const mid = player({ id: 11, name: "Mid", total_points: 120 });
    const bust = player({ id: 12, name: "Bust", total_points: 8 });
    const board = buildWorstDropsBoard(
      league({
        teams: [
          team({
            team_id: 1,
            name: "Alpha",
            owners: ["Ada"],
            roster: [star],
          }),
          team({
            team_id: 2,
            name: "Bravo",
            owners: ["Bea"],
            roster: [mid, bust],
          }),
        ],
        free_agents: [],
        players: [star, mid, bust],
        transactions: [
          tx("20260401120000", [
            {
              team_id: 1,
              action: "DROPPED",
              player_id: 11,
              player_name: "Mid",
              bid_amount: 0,
            },
          ]),
          tx("20260501120000", [
            {
              team_id: 1,
              action: "DROPPED",
              player_id: 10,
              player_name: "Star",
              bid_amount: 0,
            },
          ]),
          tx("20260515120000", [
            {
              team_id: 1,
              action: "WAIVER DROPPED",
              player_id: 10,
              player_name: "Star",
              bid_amount: 0,
            },
          ]),
          tx("20260601120000", [
            {
              team_id: 2,
              action: "DROPPED",
              player_id: 12,
              player_name: "Bust",
              bid_amount: 0,
            },
          ]),
          tx("20260701120000", [
            {
              team_id: 2,
              action: "TRADED",
              player_id: 99,
              player_name: "Trade Chip",
              bid_amount: 0,
            },
          ]),
        ],
      }),
    );
    expect(board.hasTransactions).toBe(true);
    expect(board.rows.map((row) => row.playerName)).toEqual([
      "Star",
      "Mid",
      "Bust",
    ]);
    expect(board.rows[0]?.seasonFp).toBe(400);
    expect(board.rows[0]?.dateLabel).toMatch(/2026/);
    expect(board.rows[0]?.teamName).toBe("Alpha");
    expect(board.rows[0]?.ownerLabel).toBe("Ada");
    expect(board.byTeam.map((section) => section.teamName)).toEqual([
      "Alpha",
      "Bravo",
    ]);
    expect(board.byTeam[0]?.rows).toHaveLength(2);
  });

  it("records who claimed after and flags a same-team re-add", () => {
    const claimed = player({ id: 20, name: "Claimed", total_points: 200 });
    const bounce = player({ id: 21, name: "Bounce", total_points: 90 });
    const board = buildWorstDropsBoard(
      league({
        teams: [
          team({ team_id: 1, name: "Alpha", owners: ["Ada"], roster: [] }),
          team({ team_id: 2, name: "Bravo", owners: ["Bea"], roster: [claimed] }),
        ],
        free_agents: [bounce],
        transactions: [
          tx("20260401120000", [
            {
              team_id: 1,
              action: "DROPPED",
              player_id: 20,
              player_name: "Claimed",
              bid_amount: 0,
            },
          ]),
          tx("20260402120000", [
            {
              team_id: 2,
              action: "WAIVER ADDED",
              player_id: 20,
              player_name: "Claimed",
              bid_amount: 7,
            },
          ]),
          tx("20260501120000", [
            {
              team_id: 1,
              action: "DROPPED",
              player_id: 21,
              player_name: "Bounce",
              bid_amount: 0,
            },
          ]),
          tx("20260508120000", [
            {
              team_id: 1,
              action: "FA ADDED",
              player_id: 21,
              player_name: "Bounce",
              bid_amount: 0,
            },
          ]),
        ],
      }),
    );
    const claimedRow = board.rows.find((row) => row.playerName === "Claimed");
    const bounceRow = board.rows.find((row) => row.playerName === "Bounce");
    expect(claimedRow?.claimedByTeamName).toBe("Bravo");
    expect(claimedRow?.claimedByOwnerLabel).toBe("Bea");
    expect(claimedRow?.claimedAction).toBe("WAIVER ADDED");
    expect(claimedRow?.reAddedBySameTeam).toBe(false);
    expect(claimedRow?.seasonFp).toBe(200);
    expect(bounceRow?.claimedByTeamName).toBe("Alpha");
    expect(bounceRow?.reAddedBySameTeam).toBe(true);
    expect(bounceRow?.seasonFp).toBe(90);
  });

  it("uses free-agent totals when the player is no longer rostered", () => {
    const board = buildWorstDropsBoard(
      league({
        teams: [team({ team_id: 1, roster: [] })],
        free_agents: [player({ id: 33, name: "Wire", total_points: 155.4 })],
        transactions: [
          tx("20260801120000", [
            {
              team_id: 1,
              action: "DROPPED",
              player_id: 33,
              player_name: "Wire",
              bid_amount: 0,
            },
          ]),
        ],
      }),
    );
    expect(board.rows[0]?.seasonFp).toBe(155.4);
  });

  it("shows no drop rows when the ledger is only adds and trades", () => {
    const board = buildWorstDropsBoard(
      league({
        teams: [team({ team_id: 1 })],
        transactions: [
          tx("20260901120000", [
            {
              team_id: 1,
              action: "FA ADDED",
              player_id: 1,
              player_name: "Add Only",
              bid_amount: 0,
            },
          ]),
        ],
      }),
    );
    expect(board.hasTransactions).toBe(true);
    expect(board.rows).toEqual([]);
  });

  it("does not treat an unparseable drop date as before a dated add", () => {
    const board = buildWorstDropsBoard(
      league({
        teams: [team({ team_id: 1, name: "Alpha", owners: ["Ada"] })],
        free_agents: [player({ id: 44, name: "Odd Date", total_points: 77 })],
        transactions: [
          tx("20260401120000", [
            {
              team_id: 1,
              action: "FA ADDED",
              player_id: 44,
              player_name: "Odd Date",
              bid_amount: 0,
            },
          ]),
          tx("20260987400000", [
            {
              team_id: 1,
              action: "DROPPED",
              player_id: 44,
              player_name: "Odd Date",
              bid_amount: 0,
            },
          ]),
        ],
      }),
    );
    expect(board.rows[0]?.claimedByTeamName).toBeNull();
    expect(board.rows[0]?.reAddedBySameTeam).toBe(false);
  });

  it("ranks the baseball-dynasty fixture drop by Daniel Moore season FP", () => {
    const snapshot = JSON.parse(
      readFileSync(path.join(FIXTURES, "baseball-dynasty/2026.json"), "utf8"),
    ) as LeagueSnapshot;
    const board = buildWorstDropsBoard(snapshot);
    expect(board.hasTransactions).toBe(true);
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0]?.playerName).toBe("Daniel Moore");
    expect(board.rows[0]?.seasonFp).toBe(541.5);
    expect(board.rows[0]?.teamName).toBe("Diamond Dogs");
    expect(board.rows[0]?.ownerLabel).toBe("Bruce Green");
    expect(board.rows[0]?.dateLabel).toMatch(/2026/);
    expect(board.rows[0]?.dateLabel).not.toBe("20260987400000");
    expect(board.rows[0]?.claimedByTeamName).toBeNull();
    expect(board.rows[0]?.reAddedBySameTeam).toBe(false);
  });
});
