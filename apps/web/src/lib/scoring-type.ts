/**
 * ESPN scoringType helpers — baseball Season Points vs H2H category, etc.
 *
 * Live Strictly Jayers baseball uses ``TOTAL_SEASON_POINTS`` (ESPN UI label
 * "Season Points"): standings are cumulative fantasy points from weighted
 * stats, not H2H category wins.
 */

export function isSeasonPointsScoring(
  scoringType: string | null | undefined,
): boolean {
  return scoringType === "TOTAL_SEASON_POINTS";
}

/** H2H each-category, most-categories, or rotisserie — not points. */
export function isCategoryScoring(
  scoringType: string | null | undefined,
): boolean {
  return (
    scoringType === "H2H_CATEGORY" ||
    scoringType === "H2H_MOST_CATEGORIES" ||
    scoringType === "ROTO"
  );
}

/** Friendly label for league chrome / settings. */
export function scoringTypeLabel(
  scoringType: string | null | undefined,
): string | null {
  if (!scoringType) return null;
  if (scoringType === "TOTAL_SEASON_POINTS") return "Season Points";
  if (scoringType === "H2H_POINTS") return "H2H Points";
  if (scoringType === "H2H_CATEGORY") return "H2H Each Category";
  if (scoringType === "H2H_MOST_CATEGORIES") return "H2H Most Categories";
  if (scoringType === "ROTO") return "Rotisserie";
  return scoringType
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

/** Baseball tools that assume category/roto standings. */
export function baseballToolsForScoring(
  scoringType: string | null | undefined,
): ReadonlyArray<"categories" | "usage" | "trailing" | "schedule" | "locks"> {
  if (isSeasonPointsScoring(scoringType)) {
    return ["usage", "trailing", "schedule", "locks"];
  }
  return ["categories", "usage", "trailing", "schedule", "locks"];
}
