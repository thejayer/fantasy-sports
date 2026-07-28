/**
 * Join hub ESPN player ids to ffa projection rows via the player map (roadmap 4.4).
 * Pure helpers — pages load snapshots with getProjectionSnapshot / getPlayerMap.
 */

import type {
  LeagueSnapshot,
  LeagueSettings,
  Player,
  PlayerMapSnapshot,
  ProjectionPlayer,
  ProjectionSnapshot,
} from "@/lib/data";

export type PlayerWithProjection = Player & {
  projection: ProjectionPlayer | null;
};

export function normalizeEspnId(
  value: string | number | null | undefined,
): string | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return String(Math.trunc(value));
  }
  const text = value.trim();
  if (!text || text.toLowerCase() === "nan") return null;
  if (text.endsWith(".0") && /^-?\d+\.0$/.test(text)) {
    return text.slice(0, -2);
  }
  const asNum = Number(text);
  if (Number.isFinite(asNum) && Number.isInteger(asNum)) {
    return String(asNum);
  }
  return text;
}

/** Reception points from settings.scoring_format, if present. */
export function receptionPoints(
  settings: LeagueSettings | null | undefined,
): number | null {
  const rows = settings?.scoring_format ?? [];
  for (const row of rows) {
    const abbr = (row.abbr ?? "").toUpperCase();
    const label = (row.label ?? "").toLowerCase();
    if (
      abbr === "REC" ||
      abbr === "RECEP" ||
      label.includes("reception") ||
      label === "rec"
    ) {
      return row.points ?? null;
    }
  }
  return null;
}

/**
 * Projection store slug (`ppr` / `standard`). Nightly refresh only exports those two.
 * Half-PPR leagues fall back to `ppr` until a dedicated export exists.
 */
export function scoringSlugFromLeague(
  league: Pick<LeagueSnapshot, "sport" | "settings" | "scoring_type">,
): string {
  if (league.sport !== "football") return "ppr";
  const rec = receptionPoints(league.settings);
  if (rec === 0) return "standard";
  if (rec != null && rec > 0) return "ppr";
  // ESPN H2H_POINTS / unknown — default PPR (matches Strictly Jayers main league).
  return "ppr";
}

/**
 * True when the league scores fractional receptions (typically 0.5) but the store
 * only has full-PPR / standard exports — UI should disclose the PPR fallback.
 */
export function usesHalfPprScoringFallback(
  league: Pick<LeagueSnapshot, "sport" | "settings" | "scoring_type">,
): boolean {
  if (league.sport !== "football") return false;
  const rec = receptionPoints(league.settings);
  return rec != null && rec > 0 && rec < 1;
}

/** Hub fantasy seasons can lead the NFL calendar; try current then prior. */
export function projectionSeasonCandidates(leagueSeason: number): number[] {
  if (!Number.isFinite(leagueSeason)) return [];
  const year = Math.trunc(leagueSeason);
  return year > 0 ? [year, year - 1] : [];
}

export function indexPlayerMap(
  map: PlayerMapSnapshot | null | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of map?.mappings ?? []) {
    const espn = normalizeEspnId(row.espn_id);
    const gsis = row.player_id?.trim();
    if (espn && gsis) out.set(espn, gsis);
  }
  return out;
}

export function indexProjections(
  snap: ProjectionSnapshot | null | undefined,
): Map<string, ProjectionPlayer> {
  const out = new Map<string, ProjectionPlayer>();
  for (const row of snap?.players ?? []) {
    const gsis = row.player_id?.trim();
    if (gsis) out.set(gsis, row);
  }
  return out;
}

export function projectionForEspnId(
  espnId: string | number | null | undefined,
  espnToGsis: Map<string, string>,
  byGsis: Map<string, ProjectionPlayer>,
): ProjectionPlayer | null {
  const espn = normalizeEspnId(espnId);
  if (!espn) return null;
  const gsis = espnToGsis.get(espn);
  if (!gsis) return null;
  return byGsis.get(gsis) ?? null;
}

export function attachPlayerProjections(
  players: Player[],
  espnToGsis: Map<string, string>,
  byGsis: Map<string, ProjectionPlayer>,
): PlayerWithProjection[] {
  return players.map((player) => ({
    ...player,
    projection: projectionForEspnId(player.id, espnToGsis, byGsis),
  }));
}

export function formatProjectionPoints(
  value: number | null | undefined,
  digits = 1,
): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}
