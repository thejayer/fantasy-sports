import { describe, expect, it } from "vitest";

import { emptyFeed, type LeagueFeed } from "@/lib/feed";
import {
  collectMemberFeedActivity,
  formatActivityWhen,
  profileTrophyChips,
} from "@/lib/member-profile";
import type { FranchiseCareer } from "@/lib/history";

function careerWithTitles(n: number): FranchiseCareer {
  return {
    teamId: 4,
    name: "Hail Mary Heroes",
    abbrev: "HMH",
    owners: ["Demo"],
    seasons: [],
    totals: {
      teamId: 4,
      name: "Hail Mary Heroes",
      abbrev: "HMH",
      owners: ["Demo"],
      seasons: n,
      wins: 10,
      losses: 4,
      ties: 0,
      pointsFor: 1200,
      pointsAgainst: 1100,
      championships: n,
      winPct: 0.714,
    },
    rivals: [],
  };
}

describe("profileTrophyChips", () => {
  it("emits #1 chips that deep-link to the trophy case", () => {
    const chips = profileTrophyChips([
      {
        link: {
          league_id: "football-main",
          team_id: 4,
          league_name: "Strictly Jayers Football",
        },
        career: careerWithTitles(2),
        season: 2026,
        leagueName: "Strictly Jayers Football",
      },
      {
        link: { league_id: "baseball-dynasty", team_id: 1 },
        career: null,
        season: 2026,
        leagueName: "Baseball",
      },
    ]);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({
      label: "2× #1",
      detail: "Strictly Jayers Football",
      href: "/leagues/football-main?season=2026&tab=history&view=trophies",
    });
  });
});

describe("collectMemberFeedActivity", () => {
  it("collects comments, polls, and reactions newest first", () => {
    const feed: LeagueFeed = {
      ...emptyFeed("football-main", 2026, new Date("2026-08-01T12:00:00Z")),
      comments: [
        {
          id: "c1",
          target_id: "league",
          body: "Draft night is sacred.",
          author_email: "jay@example.com",
          author_name: "Jay",
          team_id: 1,
          created_at: "2026-08-01T10:00:00Z",
          deleted_at: null,
        },
        {
          id: "c2",
          target_id: "league",
          body: "gone",
          author_email: "jay@example.com",
          author_name: "Jay",
          team_id: 1,
          created_at: "2026-08-01T11:00:00Z",
          deleted_at: "2026-08-01T11:05:00Z",
        },
      ],
      polls: [
        {
          id: "p1",
          question: "Keeper or trade?",
          options: [
            { id: "o1", label: "Keep", voter_emails: [] },
            { id: "o2", label: "Trade", voter_emails: [] },
          ],
          author_email: "jay@example.com",
          author_name: "Jay",
          team_id: 1,
          created_at: "2026-08-01T12:00:00Z",
          closes_at: null,
          deleted_at: null,
        },
      ],
      reactions: [
        {
          target_id: "evt1",
          emoji: "🔥",
          author_email: "jay@example.com",
          created_at: "2026-08-01T09:00:00Z",
        },
        {
          target_id: "evt1",
          emoji: "👍",
          author_email: "other@example.com",
          created_at: "2026-08-01T13:00:00Z",
        },
      ],
    };

    const items = collectMemberFeedActivity(
      [{ feed, leagueName: "Football" }],
      "Jay@Example.com",
      { limit: 10 },
    );
    expect(items.map((i) => i.kind)).toEqual(["poll", "comment", "reaction"]);
    expect(items[0].body).toBe("Keeper or trade?");
    expect(items[1].body).toBe("Draft night is sacred.");
    expect(items[2].title).toBe("Reacted 🔥");
    expect(formatActivityWhen("2026-08-01T12:00:00Z")).toMatch(/Aug/);
  });
});
