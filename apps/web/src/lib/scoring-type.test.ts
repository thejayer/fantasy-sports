import { describe, expect, it } from "vitest";

import {
  baseballToolsForScoring,
  isCategoryScoring,
  isSeasonPointsScoring,
  scoringTypeLabel,
} from "@/lib/scoring-type";

describe("scoring-type", () => {
  it("detects ESPN Season Points", () => {
    expect(isSeasonPointsScoring("TOTAL_SEASON_POINTS")).toBe(true);
    expect(isSeasonPointsScoring("H2H_POINTS")).toBe(false);
    expect(isSeasonPointsScoring(null)).toBe(false);
  });

  it("detects category / roto formats", () => {
    expect(isCategoryScoring("H2H_CATEGORY")).toBe(true);
    expect(isCategoryScoring("ROTO")).toBe(true);
    expect(isCategoryScoring("TOTAL_SEASON_POINTS")).toBe(false);
  });

  it("labels Season Points for chrome", () => {
    expect(scoringTypeLabel("TOTAL_SEASON_POINTS")).toBe("Season Points");
    expect(scoringTypeLabel("H2H_CATEGORY")).toBe("H2H Each Category");
  });

  it("hides Category Board for Season Points tools", () => {
    expect(baseballToolsForScoring("TOTAL_SEASON_POINTS")).not.toContain(
      "categories",
    );
    expect(baseballToolsForScoring("H2H_CATEGORY")).toContain("categories");
  });
});
