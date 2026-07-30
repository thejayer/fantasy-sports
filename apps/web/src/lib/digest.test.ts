import { describe, expect, it } from "vitest";

import type { LeagueSnapshot, Team } from "@/lib/data";
import {
  buildWeeklyDigest,
  digestAsFeedEvent,
  powerRankings,
  trueAllPlayWinPct,
} from "@/lib/digest";
import { formatDigestMessage } from "@/lib/digest";
import { deliverDigestToDiscord } from "@/lib/digest-transport";

function team(
  id: number,
  name: string,
  schedule: number[],
  scores: number[],
  outcomes: string[],
  pointsFor: number,
): Team {
  return {
    team_id: id,
    name,
    abbrev: name.slice(0, 3).toUpperCase(),
    owners: [],
    wins: outcomes.filter((o) => o === "W").length,
    losses: outcomes.filter((o) => o === "L").length,
    ties: 0,
    points_for: pointsFor,
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
  team_count: 4,
  current_week: 2,
  synced_at: "2026-09-20T00:00:00Z",
  teams: [
    team(1, "Alpha", [2, 3], [120, 95], ["W", "W"], 215),
    team(2, "Beta", [1, 4], [90, 100], ["L", "W"], 190),
    team(3, "Gamma", [4, 1], [88, 80], ["W", "L"], 168),
    team(4, "Delta", [3, 2], [70, 85], ["L", "L"], 155),
  ],
  players: [],
  draft: [],
  transactions: [
    {
      date: "20260910120000",
      actions: [
        {
          team_id: 1,
          action: "FA ADDED",
          player_id: 10,
          player_name: "Streamer",
          bid_amount: 3,
        },
      ],
    },
  ],
};

describe("weekly digest (roadmap 7.7)", () => {
  it("computes true all-play win pct across the slate", () => {
    // Week 1 scores: 120, 90, 88, 70 — Alpha beats everyone.
    expect(trueAllPlayWinPct(league.teams, 1, 1)).toBe(1);
    expect(trueAllPlayWinPct(league.teams, 4, 1)).toBe(0);
  });

  it("ranks by all-play then points for", () => {
    const ranks = powerRankings(league.teams, 2);
    expect(ranks[0].teamId).toBe(1);
    expect(ranks.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it("builds awards and a stable feed event id", () => {
    const digest = buildWeeklyDigest(league, 1);
    expect(digest).not.toBeNull();
    expect(digest!.awards.some((a) => a.id === "high_score")).toBe(true);
    expect(digest!.awards.some((a) => a.id === "blowout")).toBe(true);
    const event = digestAsFeedEvent(digest!);
    expect(event.id).toBe("digest:football-main:2026:1");
    expect(event.kind).toBe("digest");
    expect(formatDigestMessage(digest!)).toContain("Week 1 recap");
  });

  it("returns null when a period has no decided games", () => {
    const unfinished: LeagueSnapshot = {
      ...league,
      teams: league.teams.map((t) => ({
        ...t,
        outcomes: ["U", "U"],
        scores: [null, null],
      })),
    };
    expect(buildWeeklyDigest(unfinished, 1)).toBeNull();
  });
});

describe("digest transport", () => {
  it("no-ops clearly when the webhook env is unset", async () => {
    const prev = process.env.SJ_DISCORD_WEBHOOK_URL;
    delete process.env.SJ_DISCORD_WEBHOOK_URL;
    const result = await deliverDigestToDiscord("hello");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.channel).toBe("none");
    if (prev != null) process.env.SJ_DISCORD_WEBHOOK_URL = prev;
  });

  it("posts to a provided webhook URL", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const result = await deliverDigestToDiscord("**Week 1**", {
      webhookUrl: "https://discord.example/webhook",
      fetchImpl: (async (url, init) => {
        calls.push({ url: String(url), body: String(init?.body) });
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toContain("Week 1");
  });
});
