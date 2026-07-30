/**
 * One player's story inside one league-season (roadmap 7.3).
 *
 * No new data: the roster row, the draft pick, and every transaction touching
 * the player are already keyed by player id in `rosters.json`, `draft.json`, and
 * `transactions.json`. Projections join through the existing player map.
 * AUDIT-COMPETITIVE #3 — player names were links to nowhere.
 */

import type {
  DraftPick,
  LeagueSnapshot,
  Player,
  ProjectionPlayer,
  Team,
} from "@/lib/data";
import { activityRowsForLeague, type ActivityActionRow } from "@/lib/activity";

export type PlayerProfile = {
  player: Player;
  /** Fantasy team when rostered; null for a free agent. */
  team: Team | null;
  /** True when the player came from `free_agents` rather than a roster. */
  freeAgent: boolean;
  draftPick: DraftPick | null;
  transactions: ActivityActionRow[];
};

/**
 * ESPN ids arrive as numbers on rosters and strings in some snapshots, so
 * compare as trimmed strings throughout.
 */
export function samePlayerId(
  a: Player["id"] | number | string | null | undefined,
  b: Player["id"] | number | string | null | undefined,
): boolean {
  if (a == null || b == null) return false;
  return String(a).trim() === String(b).trim();
}

export function findPlayerInLeague(
  league: LeagueSnapshot,
  playerId: string,
): PlayerProfile | null {
  const key = playerId.trim();
  if (!key) return null;

  let found: Player | null = null;
  let team: Team | null = null;
  for (const candidate of league.teams) {
    const hit = candidate.roster.find((row) => samePlayerId(row.id, key));
    if (hit) {
      found = hit;
      team = candidate;
      break;
    }
  }

  // `players` carries the league-wide board; prefer the roster row (it has the
  // lineup slot) but fall back so a player present only there still resolves.
  if (!found) {
    found = league.players.find((row) => samePlayerId(row.id, key)) ?? null;
  }

  let freeAgent = false;
  if (!found) {
    found =
      (league.free_agents ?? []).find((row) => samePlayerId(row.id, key)) ??
      null;
    freeAgent = Boolean(found);
  }

  if (!found) return null;

  const draftPick =
    (league.draft ?? []).find((pick) => samePlayerId(pick.player_id, key)) ??
    null;

  const transactions = activityRowsForLeague(league, "all").filter((row) =>
    samePlayerId(row.playerId, key),
  );

  return { player: found, team, freeAgent, draftPick, transactions };
}

/** Rostered-percentage-style label for the profile header. */
export function playerRosterLabel(profile: PlayerProfile): string {
  if (profile.team) {
    return profile.player.slot && profile.player.slot !== "BE"
      ? `${profile.team.name} · ${profile.player.slot}`
      : profile.team.name;
  }
  return profile.freeAgent ? "Free agent" : "Unrostered";
}

export type PlayerStatLine = { label: string; value: string };

function num(value: number | null | undefined, digits = 1): string | null {
  if (value == null || Number.isNaN(value)) return null;
  return value.toFixed(digits);
}

/**
 * Header stat chips. Football leans on fantasy points; baseball surfaces the
 * counting stats the roster boards already show.
 */
export function playerStatLines(
  player: Player,
  sport: string,
): PlayerStatLine[] {
  const lines: PlayerStatLine[] = [];
  const push = (label: string, value: string | null) => {
    if (value != null) lines.push({ label, value });
  };

  push("Points", num(player.total_points));
  push("Avg", num(player.avg_points));
  push("Projected", num(player.projected_total_points));
  if (player.percent_owned != null) {
    push("Rostered", `${player.percent_owned.toFixed(1)}%`);
  }

  if (sport === "baseball") {
    const stats = player.season_stats ?? {};
    push("HR", num(stats.HR, 0));
    push("RBI", num(stats.RBI, 0));
    push("AVG", num(stats.AVG, 3));
    push("OPS", num(stats.OPS, 3));
    push("K", num(stats.K, 0));
    push("ERA", num(stats.ERA, 2));
    push("WHIP", num(stats.WHIP, 2));
  }

  if (sport === "golf" && player.season_stats?.OWGR != null) {
    push("OWGR", num(player.season_stats.OWGR, 0));
  }

  return lines;
}

/** Quantile chips from a joined projection row. */
export function projectionStatLines(
  projection: ProjectionPlayer | null | undefined,
  label = "season",
): PlayerStatLine[] {
  if (!projection) return [];
  const lines: PlayerStatLine[] = [];
  const push = (name: string, value: number | null | undefined, digits = 1) => {
    if (value == null || Number.isNaN(value)) return;
    lines.push({ label: `${name} (${label})`, value: value.toFixed(digits) });
  };
  push("Floor", projection.floor);
  push("Median", projection.median);
  push("Ceiling", projection.ceiling);
  push("VOR", projection.vor);
  if (projection.tier != null) {
    lines.push({ label: `Tier (${label})`, value: String(projection.tier) });
  }
  return lines;
}
