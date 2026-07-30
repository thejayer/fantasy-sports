import { describe, expect, it } from "vitest";

import {
  espnLeagueUrl,
  espnPlayerUrl,
  espnPlayersUrl,
  espnSettingsUrl,
  espnTeamUrl,
  espnTransactionsUrl,
} from "@/lib/espn-links";

const football = { sport: "football", espnLeagueId: 39790, season: 2026 };
const baseball = { sport: "baseball", espnLeagueId: 2499137, season: 2026 };
const golf = { sport: "golf", espnLeagueId: null, season: 2026 };

describe("espn-links (roadmap 7.3)", () => {
  it("builds league-scoped urls per sport", () => {
    expect(espnLeagueUrl(football)).toBe(
      "https://fantasy.espn.com/football/league?leagueId=39790&seasonId=2026",
    );
    expect(espnLeagueUrl(baseball)).toBe(
      "https://fantasy.espn.com/baseball/league?leagueId=2499137&seasonId=2026",
    );
  });

  it("includes the team id on team urls", () => {
    expect(espnTeamUrl(football, 8)).toBe(
      "https://fantasy.espn.com/football/team?leagueId=39790&seasonId=2026&teamId=8",
    );
  });

  it("covers the add-player, transactions, and settings destinations", () => {
    expect(espnPlayersUrl(football)).toContain("/football/players/add?");
    expect(espnTransactionsUrl(football)).toContain("/league/transactions?");
    expect(espnSettingsUrl(football)).toContain("/league/settings?");
  });

  it("returns null for hub-native sports with no ESPN league", () => {
    expect(espnLeagueUrl(golf)).toBeNull();
    expect(espnTeamUrl(golf, 1)).toBeNull();
    expect(espnPlayersUrl(golf)).toBeNull();
    expect(espnSettingsUrl(golf)).toBeNull();
  });

  it("returns null when the snapshot has no ESPN league id", () => {
    expect(espnLeagueUrl({ ...football, espnLeagueId: null })).toBeNull();
    expect(espnLeagueUrl({ ...football, espnLeagueId: undefined })).toBeNull();
  });

  it("links player cards on the main site, which needs no league", () => {
    expect(espnPlayerUrl("football", 3139477)).toBe(
      "https://www.espn.com/nfl/player/_/id/3139477",
    );
    expect(espnPlayerUrl("baseball", "33192")).toBe(
      "https://www.espn.com/mlb/player/_/id/33192",
    );
  });

  it("refuses non-numeric or hub-native player ids", () => {
    // Golf ids are hub-generated and mean nothing to ESPN.
    expect(espnPlayerUrl("golf", 12)).toBeNull();
    expect(espnPlayerUrl("football", "abc")).toBeNull();
    expect(espnPlayerUrl("football", null)).toBeNull();
    expect(espnPlayerUrl("football", "")).toBeNull();
  });
});
