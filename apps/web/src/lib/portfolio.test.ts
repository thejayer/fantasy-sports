import { describe, expect, it } from "vitest";

import type { HomeLeagueCard } from "@/lib/member-home";
import {
  buildPortfolioRows,
  formatPortfolioMatchup,
  formatPortfolioPct,
  formatPortfolioStanding,
  withPlayoffOdds,
} from "@/lib/portfolio";
import type { PlayoffOddsSnapshot } from "@/lib/data";

function card(partial: Partial<HomeLeagueCard> = {}): HomeLeagueCard {
  return {
    leagueId: "football-main",
    name: "Strictly Jayers Football",
    sport: "football",
    format: "redraft",
    season: 2026,
    periodLabel: "week",
    currentPeriod: 14,
    team: {
      teamId: 1,
      name: "Alpha",
      record: "8-6",
      winPct: ".571",
      standing: 1,
      teamCount: 12,
      pointsFor: 1400,
    },
    matchup: {
      periodLabel: "week",
      period: 14,
      opponentName: "Bravo",
      opponentId: 2,
      score: 103.2,
      opponentScore: 98.1,
      outcome: "W",
      bye: false,
      decided: true,
    },
    next: null,
    actions: [],
    href: "/leagues/football-main?season=2026",
    ...partial,
  };
}

describe("portfolio helpers (roadmap 9.4)", () => {
  it("formats standing, pct, and decided matchups", () => {
    expect(formatPortfolioStanding(3, 12)).toBe("3 of 12");
    expect(formatPortfolioStanding(null, 12)).toBeNull();
    expect(formatPortfolioPct(0.42)).toBe("42%");
    expect(formatPortfolioPct(null)).toBeNull();
    expect(
      formatPortfolioMatchup({
        periodLabel: "week",
        period: 2,
        opponentName: "Bravo",
        opponentId: 2,
        score: 10,
        opponentScore: 8,
        outcome: "W",
        bye: false,
        decided: true,
      }),
    ).toBe("W 10–8 vs Bravo");
    expect(
      formatPortfolioMatchup({
        periodLabel: "period",
        period: 24,
        opponentName: null,
        opponentId: null,
        score: null,
        opponentScore: null,
        outcome: "U",
        bye: true,
        decided: false,
      }),
    ).toBe("Bye · period 24");
  });

  it("builds rows and attaches football make%", () => {
    const odds = {
      schema_version: 1,
      generated_at: "2026-07-27T00:00:00Z",
      league_id: "football-main",
      season: 2026,
      scoring: "ppr",
      n_sims: 100,
      teams: [
        {
          team_id: 1,
          name: "Alpha",
          standing_now: 1,
          wins_now: 8,
          losses_now: 6,
          make_playoffs: 0.91,
          delta_make: 0.04,
          seed_probs: {},
          avg_wins: 10,
          mapped_roster: 1,
          rostered: 15,
        },
      ],
    } as PlayoffOddsSnapshot;

    const enriched = withPlayoffOdds(card(), odds);
    expect(enriched.makePlayoffs).toBe(0.91);
    expect(enriched.makePlayoffsDelta).toBe(0.04);

    const rows = buildPortfolioRows([
      enriched,
      card({
        leagueId: "golf-main",
        name: "Strictly Jayers Golf",
        sport: "golf",
        format: "snake",
        team: null,
        matchup: null,
        makePlayoffs: null,
      }),
    ]);
    expect(rows[0]?.makePlayoffs).toBe("91% (+4%)");
    expect(rows[0]?.standing).toBe("1 of 12");
    expect(rows[0]?.linked).toBe(true);
    expect(rows[1]?.teamHref).toBeNull();
    expect(rows[1]?.record).toBeNull();
    expect(rows[1]?.matchup).toBe("—");
  });

  it("leaves odds alone when snapshot missing or team unlinked", () => {
    expect(withPlayoffOdds(card(), null).makePlayoffs).toBeUndefined();
    expect(
      withPlayoffOdds(card({ team: null }), {
        teams: [{ team_id: 1, make_playoffs: 0.5 }],
      } as PlayoffOddsSnapshot).makePlayoffs,
    ).toBeUndefined();
  });
});
