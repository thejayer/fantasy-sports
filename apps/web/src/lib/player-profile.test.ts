import { describe, expect, it } from "vitest";

import type { LeagueSnapshot, Player, Team } from "@/lib/data";
import {
  findPlayerInLeague,
  playerRosterLabel,
  playerStatLines,
  projectionStatLines,
  samePlayerId,
} from "@/lib/player-profile";

function player(partial: Partial<Player> & Pick<Player, "id" | "name">): Player {
  return {
    position: "QB",
    slot: "QB",
    pro_team: "KC",
    injury_status: null,
    total_points: 100,
    projected_total_points: null,
    avg_points: null,
    ...partial,
  };
}

function team(id: number, name: string, roster: Player[]): Team {
  return {
    team_id: id,
    name,
    abbrev: name.slice(0, 3),
    owners: ["Owner"],
    wins: 0,
    losses: 0,
    ties: 0,
    points_for: 0,
    points_against: 0,
    standing: id,
    division: "",
    roster,
  };
}

const rostered = player({ id: 11, name: "Rostered Rick" });
const benched = player({ id: 12, name: "Bench Bob", slot: "BE" });
const freeAgent = player({ id: 13, name: "Wire Walter", slot: null });
const boardOnly = player({ id: 14, name: "Board Betty" });

const league = {
  league_id: "demo",
  espn_league_id: 99,
  sport: "football",
  format: "redraft",
  season: 2026,
  name: "Demo",
  team_count: 1,
  current_week: 3,
  teams: [team(1, "Alpha", [rostered, benched])],
  players: [rostered, benched, boardOnly],
  free_agents: [freeAgent],
  draft: [
    {
      round: 2,
      round_pick: 5,
      team_id: 1,
      player_id: 11,
      player_name: "Rostered Rick",
      bid_amount: 14,
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
          player_id: 11,
          player_name: "Rostered Rick",
          bid_amount: 0,
        },
        {
          team_id: 1,
          action: "DROPPED",
          player_id: 99,
          player_name: "Someone Else",
          bid_amount: 0,
        },
      ],
    },
  ],
} as LeagueSnapshot;

describe("samePlayerId", () => {
  it("compares ids as trimmed strings across number/string snapshots", () => {
    expect(samePlayerId(11, "11")).toBe(true);
    expect(samePlayerId(" 11 ", 11)).toBe(true);
    expect(samePlayerId(11, 12)).toBe(false);
  });

  it("never matches a null id", () => {
    expect(samePlayerId(null, null)).toBe(false);
    expect(samePlayerId(null, 11)).toBe(false);
    expect(samePlayerId(undefined, "")).toBe(false);
  });
});

describe("findPlayerInLeague (roadmap 7.3)", () => {
  it("resolves a rostered player with their team, draft pick, and transactions", () => {
    const profile = findPlayerInLeague(league, "11");
    expect(profile).not.toBeNull();
    expect(profile!.player.name).toBe("Rostered Rick");
    expect(profile!.team?.name).toBe("Alpha");
    expect(profile!.freeAgent).toBe(false);
    expect(profile!.draftPick?.round).toBe(2);
    // Only actions naming this player, not the whole transaction.
    expect(profile!.transactions).toHaveLength(1);
    expect(profile!.transactions[0].action).toBe("FA ADDED");
  });

  it("prefers the roster row so the lineup slot is present", () => {
    expect(findPlayerInLeague(league, "12")!.player.slot).toBe("BE");
  });

  it("falls back to the league-wide board when nobody rosters the player", () => {
    const profile = findPlayerInLeague(league, "14");
    expect(profile!.player.name).toBe("Board Betty");
    expect(profile!.team).toBeNull();
    expect(profile!.freeAgent).toBe(false);
  });

  it("resolves free agents and flags them", () => {
    const profile = findPlayerInLeague(league, "13");
    expect(profile!.freeAgent).toBe(true);
    expect(playerRosterLabel(profile!)).toBe("Free agent");
  });

  it("returns null for an unknown or blank id", () => {
    expect(findPlayerInLeague(league, "404")).toBeNull();
    expect(findPlayerInLeague(league, "   ")).toBeNull();
  });
});

describe("playerRosterLabel", () => {
  it("names the starting slot but not the bench", () => {
    expect(playerRosterLabel(findPlayerInLeague(league, "11")!)).toBe(
      "Alpha · QB",
    );
    expect(playerRosterLabel(findPlayerInLeague(league, "12")!)).toBe("Alpha");
  });
});

describe("playerStatLines", () => {
  it("omits stats the snapshot does not carry", () => {
    const lines = playerStatLines(player({ id: 1, name: "X" }), "football");
    expect(lines.map((l) => l.label)).toEqual(["Points"]);
  });

  it("adds baseball counting stats when present", () => {
    const lines = playerStatLines(
      player({
        id: 1,
        name: "X",
        season_stats: { HR: 30, RBI: 90, AVG: 0.301, OPS: 0.9 },
      }),
      "baseball",
    );
    const labels = lines.map((l) => l.label);
    expect(labels).toContain("HR");
    expect(lines.find((l) => l.label === "AVG")?.value).toBe("0.301");
  });

  it("does not show baseball stats on a football league", () => {
    const lines = playerStatLines(
      player({ id: 1, name: "X", season_stats: { HR: 30 } }),
      "football",
    );
    expect(lines.map((l) => l.label)).not.toContain("HR");
  });
});

describe("projectionStatLines", () => {
  it("labels the grain so season and week chips do not collide", () => {
    const lines = projectionStatLines(
      {
        player_id: "00-1",
        player_name: "X",
        position: "QB",
        team: "KC",
        points_mean: 300,
        points_sd: 40,
        floor: 240,
        median: 300,
        ceiling: 360,
        vor: 55,
        tier: 1,
      },
      "week",
    );
    expect(lines.map((l) => l.label)).toEqual([
      "Floor (week)",
      "Median (week)",
      "Ceiling (week)",
      "VOR (week)",
      "Tier (week)",
    ]);
  });

  it("is empty without a projection", () => {
    expect(projectionStatLines(null)).toEqual([]);
  });
});
