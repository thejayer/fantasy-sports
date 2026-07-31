/**
 * Multi-league portfolio helpers (roadmap 9.4).
 * Dense at-a-glance rows over HomeLeagueCard — pure for Vitest.
 */

import type { HomeLeagueCard, HomeMatchup } from "@/lib/member-home";
import type { PlayoffOddsSnapshot } from "@/lib/data";
import { formatMatchupScore } from "@/lib/matchups";

export type PortfolioRow = {
  leagueId: string;
  sport: string;
  format: string;
  season: number;
  leagueName: string;
  leagueHref: string;
  teamName: string | null;
  teamHref: string | null;
  record: string | null;
  standing: string | null;
  matchup: string;
  next: string | null;
  makePlayoffs: string | null;
  linked: boolean;
};

export function formatPortfolioPct(
  value: number | null | undefined,
  digits = 0,
): string | null {
  if (value == null || Number.isNaN(value)) return null;
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatPortfolioStanding(
  standing: number | null | undefined,
  teamCount: number | null | undefined,
): string | null {
  if (standing == null) return null;
  if (teamCount != null && teamCount > 0) return `${standing} of ${teamCount}`;
  return `#${standing}`;
}

export function formatPortfolioMatchup(matchup: HomeMatchup | null): string {
  if (!matchup) return "—";
  if (matchup.bye) return `Bye · ${matchup.periodLabel} ${matchup.period}`;
  const score = `${formatMatchupScore(matchup.score)}–${formatMatchupScore(matchup.opponentScore)}`;
  const vs = matchup.opponentName ? ` vs ${matchup.opponentName}` : "";
  const outcome = (matchup.outcome || "").toUpperCase();
  if (outcome === "W" || outcome === "L" || outcome === "T") {
    return `${outcome} ${score}${vs}`;
  }
  return `${score}${vs}`;
}

export function formatPortfolioNext(card: HomeLeagueCard): string | null {
  if (!card.next || card.matchup?.bye) return null;
  const opp = card.next.opponentName ? ` vs ${card.next.opponentName}` : "";
  return `${card.periodLabel} ${card.next.period}${opp}`;
}

/** Attach football playoff make% onto a card (mutates a shallow copy). */
export function withPlayoffOdds(
  card: HomeLeagueCard,
  odds: PlayoffOddsSnapshot | null | undefined,
): HomeLeagueCard {
  if (!card.team || !odds?.teams?.length) return card;
  const row = odds.teams.find((t) => t.team_id === card.team!.teamId);
  if (!row) return card;
  return {
    ...card,
    makePlayoffs: row.make_playoffs ?? null,
    makePlayoffsDelta: row.delta_make ?? null,
  };
}

export function buildPortfolioRows(cards: HomeLeagueCard[]): PortfolioRow[] {
  return cards.map((card) => {
    const linked = card.team != null;
    const make = formatPortfolioPct(card.makePlayoffs, 0);
    const delta = formatPortfolioPct(card.makePlayoffsDelta, 0);
    let makePlayoffs: string | null = make;
    if (make && delta && card.makePlayoffsDelta != null) {
      const sign = card.makePlayoffsDelta > 0 ? "+" : "";
      makePlayoffs = `${make} (${sign}${delta})`;
    }
    return {
      leagueId: card.leagueId,
      sport: card.sport,
      format: card.format,
      season: card.season,
      leagueName: card.name,
      leagueHref: card.href,
      teamName: card.team?.name ?? null,
      teamHref: card.team
        ? `/leagues/${card.leagueId}/teams/${card.team.teamId}?season=${card.season}`
        : null,
      record: card.team?.record ?? null,
      standing: formatPortfolioStanding(
        card.team?.standing,
        card.team?.teamCount,
      ),
      matchup: formatPortfolioMatchup(card.matchup),
      next: formatPortfolioNext(card),
      makePlayoffs,
      linked,
    };
  });
}
