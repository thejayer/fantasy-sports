/**
 * Weekly recap column (roadmap 7.15).
 *
 * Facts come from the 7.7 digest (awards + true all-play power rankings).
 * Prose is generated offline / via admin POST — never on a page GET.
 */

import type { LeagueSnapshot } from "@/lib/data";
import {
  buildWeeklyDigest,
  type DigestAward,
  type PowerRankingRow,
  type WeeklyDigest,
} from "@/lib/digest";
import { gamesForPeriod } from "@/lib/matchups";

export const RECAP_SCHEMA_VERSION = 1 as const;

export type RecapGameFact = {
  leftName: string;
  leftTeamId: number;
  leftScore: number | null;
  rightName: string;
  rightTeamId: number;
  rightScore: number | null;
  outcome: string;
};

export type RecapFacts = {
  leagueId: string;
  leagueName: string;
  season: number;
  period: number;
  periodLabel: string;
  sport: "football" | "baseball";
  awards: DigestAward[];
  rankings: PowerRankingRow[];
  games: RecapGameFact[];
};

export type RecapRankingCopy = {
  team_id: number;
  blurb: string;
};

export type RecapArticle = {
  schema_version: typeof RECAP_SCHEMA_VERSION;
  league_id: string;
  season: number;
  period: number;
  sport: "football" | "baseball";
  generated_at: string;
  /** Model id, or `template` / `fixture`. */
  model: string;
  headline: string;
  dek: string;
  body: string[];
  ranking_copy: RecapRankingCopy[];
};

export function recapSport(
  sport: string,
): "football" | "baseball" | null {
  if (sport === "football" || sport === "baseball") return sport;
  return null;
}

export function recapFactsFromLeague(
  league: LeagueSnapshot,
  period: number,
): RecapFacts | null {
  const sport = recapSport(league.sport);
  if (!sport) return null;
  const digest = buildWeeklyDigest(league, period);
  if (!digest) return null;
  return recapFactsFromDigest(league, digest);
}

export function recapFactsFromDigest(
  league: LeagueSnapshot,
  digest: WeeklyDigest,
): RecapFacts | null {
  const sport = recapSport(league.sport);
  if (!sport) return null;
  const bundle = gamesForPeriod(league.teams, digest.period);
  const games: RecapGameFact[] = bundle.games
    .filter((g) => {
      const o = g.left.outcome;
      return o === "W" || o === "L" || o === "T";
    })
    .map((g) => ({
      leftName: g.left.name,
      leftTeamId: g.left.teamId,
      leftScore: g.left.score,
      rightName: g.right.name,
      rightTeamId: g.right.teamId,
      rightScore: g.right.score,
      outcome: `${g.left.outcome}-${g.right.outcome}`,
    }));
  return {
    leagueId: league.league_id,
    leagueName: league.name ?? league.league_id,
    season: digest.season,
    period: digest.period,
    periodLabel: league.period_label || (sport === "baseball" ? "period" : "week"),
    sport,
    awards: digest.awards,
    rankings: digest.powerRankings,
    games,
  };
}

const HEADLINE_MAX = 120;
const DEK_MAX = 280;
const BODY_MAX = 8;
const BLURB_MAX = 220;

function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function parseRecapArticle(raw: unknown): RecapArticle | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as Record<string, unknown>;
  if (doc.schema_version !== RECAP_SCHEMA_VERSION) return null;
  if (typeof doc.league_id !== "string" || !doc.league_id) return null;
  if (!Number.isInteger(doc.season) || !Number.isInteger(doc.period)) return null;
  if (doc.sport !== "football" && doc.sport !== "baseball") return null;
  if (typeof doc.headline !== "string" || typeof doc.dek !== "string") return null;
  if (!Array.isArray(doc.body) || !Array.isArray(doc.ranking_copy)) return null;
  const body = doc.body.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  const ranking_copy = doc.ranking_copy
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      if (!Number.isInteger(item.team_id) || typeof item.blurb !== "string") {
        return null;
      }
      return { team_id: item.team_id as number, blurb: item.blurb.trim() };
    })
    .filter((row): row is RecapRankingCopy => row != null && row.blurb.length > 0);
  if (!body.length || !ranking_copy.length) return null;
  return {
    schema_version: RECAP_SCHEMA_VERSION,
    league_id: doc.league_id,
    season: doc.season as number,
    period: doc.period as number,
    sport: doc.sport,
    generated_at:
      typeof doc.generated_at === "string"
        ? doc.generated_at
        : new Date().toISOString(),
    model: typeof doc.model === "string" ? doc.model : "unknown",
    headline: clip(doc.headline, HEADLINE_MAX),
    dek: clip(doc.dek, DEK_MAX),
    body: body.slice(0, BODY_MAX).map((p) => clip(p, 800)),
    ranking_copy: ranking_copy.map((row) => ({
      ...row,
      blurb: clip(row.blurb, BLURB_MAX),
    })),
  };
}

export function validateRecapAgainstFacts(
  article: RecapArticle,
  facts: RecapFacts,
): string | null {
  if (article.league_id !== facts.leagueId) return "league_id mismatch";
  if (article.season !== facts.season) return "season mismatch";
  if (article.period !== facts.period) return "period mismatch";
  if (article.sport !== facts.sport) return "sport mismatch";
  const expected = new Set(facts.rankings.map((r) => r.teamId));
  const ids = article.ranking_copy.map((r) => r.team_id);
  if (new Set(ids).size !== ids.length) {
    return "duplicate team_id in ranking_copy";
  }
  if (ids.length !== expected.size) {
    return "ranking_copy must cover every team once";
  }
  const got = new Set(ids);
  for (const id of expected) {
    if (!got.has(id)) return `missing ranking copy for team ${id}`;
  }
  for (const id of got) {
    if (!expected.has(id)) return `unknown team_id ${id} in ranking_copy`;
  }
  return null;
}

function fmtScore(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

/** House-style one-liner; ties must not be narrated as a win. */
export function formatTemplateGameLine(g: RecapGameFact): string {
  const [leftOut, rightOut] = g.outcome.split("-");
  if (leftOut === "T" || rightOut === "T") {
    return `${g.leftName} ${fmtScore(g.leftScore)} tied ${g.rightName} ${fmtScore(g.rightScore)}`;
  }
  const leftWon = leftOut === "W";
  const winner = leftWon ? g.leftName : g.rightName;
  const loser = leftWon ? g.rightName : g.leftName;
  const ws = leftWon ? g.leftScore : g.rightScore;
  const ls = leftWon ? g.rightScore : g.leftScore;
  return `${winner} ${fmtScore(ws)} over ${loser} ${fmtScore(ls)}`;
}

/** Deterministic house-style column when no LLM key is configured (dev / tests). */
export function writeTemplateRecap(
  facts: RecapFacts,
  now = new Date(),
): RecapArticle {
  const top = facts.rankings[0];
  const cellar = facts.rankings[facts.rankings.length - 1];
  const high = facts.awards.find((a) => a.id === "high_score");
  const blowout = facts.awards.find((a) => a.id === "blowout");
  const closest = facts.awards.find((a) => a.id === "closest");
  const lucky = facts.awards.find((a) => a.id === "lucky");
  const move = facts.awards.find((a) => a.id === "transaction");
  const label = facts.periodLabel;
  const n = facts.period;

  const gameLines = facts.games.map(formatTemplateGameLine);

  const headline = top
    ? `${top.name} still running the table after ${label} ${n}`
    : `${facts.leagueName} ${label} ${n} recap`;
  const dek = high
    ? `${high.detail}. The board did not ask for a recount.`
    : `Power rankings after ${label} ${n} in ${facts.leagueName}.`;

  const body = [
    `Week-to-week memory in ${facts.leagueName} is short, so here is ${label} ${n} before Discord rewrites it: ${gameLines.join("; ") || "the slate is in the books"}.`,
    blowout
      ? `${blowout.detail} — the kind of margin that makes the loser's bench look like a group project.`
      : closest
        ? `${closest.detail}. Somebody's kicker is sleeping fine; somebody else is not.`
        : `${top?.name ?? "The leader"} keeps the all-play crown for now.`,
    lucky
      ? `${lucky.detail}. File it under "schedule luck" and wait for the group chat to file it under something ruder.`
      : move
        ? `Transaction desk: ${move.detail}.`
        : cellar
          ? `${cellar.name} is ${cellar.record} and still in the group chat, which is the real win.`
          : "The standings moved. The takes will follow.",
  ];

  const ranking_copy: RecapRankingCopy[] = facts.rankings.map((row) => {
    if (row.rank === 1) {
      return {
        team_id: row.teamId,
        blurb: `All-play king at ${(row.allPlayWinPct * 100).toFixed(0)}%. ${row.record} on the H2H card, which is almost the same sport.`,
      };
    }
    if (row.rank === facts.rankings.length) {
      return {
        team_id: row.teamId,
        blurb: `${row.record}, ${row.pointsFor.toFixed(0)} PF. The floor is lava and also this roster.`,
      };
    }
    return {
      team_id: row.teamId,
      blurb: `${row.record}, ${(row.allPlayWinPct * 100).toFixed(0)}% all-play. Mid-table with opinions.`,
    };
  });

  return {
    schema_version: RECAP_SCHEMA_VERSION,
    league_id: facts.leagueId,
    season: facts.season,
    period: facts.period,
    sport: facts.sport,
    generated_at: now.toISOString(),
    model: "template",
    headline: clip(headline, HEADLINE_MAX),
    dek: clip(dek, DEK_MAX),
    body: body.map((p) => clip(p, 800)),
    ranking_copy,
  };
}
