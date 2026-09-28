import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { PlayerMapSnapshot, ProjectionSnapshot } from "@/lib/data";
import {
  attachPlayerProjections,
  indexPlayerMap,
  indexProjections,
  normalizeEspnId,
  projectionForEspnId,
  projectionSeasonCandidates,
  receptionPoints,
  scoringSlugFromLeague,
  usesHalfPprScoringFallback,
} from "@/lib/projection-join";

function loadJson<T>(relative: string): T {
  return JSON.parse(
    readFileSync(path.resolve(__dirname, relative), "utf8"),
  ) as T;
}

describe("projection-join (roadmap 4.4)", () => {
  const map = loadJson<PlayerMapSnapshot>(
    "../../../../fixtures/sj/player_map/2025.json",
  );
  const snap = loadJson<ProjectionSnapshot>(
    "../../../../fixtures/sj/projections/ppr/2025.json",
  );

  it("joins ESPN ids to projection rows via the player map", () => {
    const espnToGsis = indexPlayerMap(map);
    const byGsis = indexProjections(snap);
    const mahomes = projectionForEspnId(3139477, espnToGsis, byGsis);
    expect(mahomes?.player_name).toBe("Patrick Mahomes");
    expect(mahomes?.floor).toBeLessThanOrEqual(mahomes!.median!);
    expect(mahomes?.median).toBeLessThanOrEqual(mahomes!.ceiling!);
    // fixture_overlay: synthetic football-main roster id → same GSIS
    const overlay = projectionForEspnId("202600301", espnToGsis, byGsis);
    expect(overlay?.player_name).toBe("Patrick Mahomes");
    expect(projectionForEspnId("99999999", espnToGsis, byGsis)).toBeNull();
    expect(normalizeEspnId("3139477.0")).toBe("3139477");
  });

  it("attaches projections onto roster-shaped players", () => {
    const rows = attachPlayerProjections(
      [
        { id: 3139477, name: "Patrick Mahomes", position: "QB", slot: "QB", pro_team: "KC", injury_status: null, total_points: 10, projected_total_points: null, avg_points: null },
        { id: 999000001, name: "Synthetic", position: "RB", slot: "RB", pro_team: "FA", injury_status: null, total_points: 1, projected_total_points: null, avg_points: null },
      ],
      indexPlayerMap(map),
      indexProjections(snap),
    );
    expect(rows[0].projection?.player_id).toBe("00-0033873");
    expect(rows[1].projection).toBeNull();
  });

  it("derives scoring slug from reception points", () => {
    expect(
      scoringSlugFromLeague({
        sport: "football",
        scoring_type: "H2H_POINTS",
        settings: { scoring_format: [{ abbr: "REC", label: "Receptions", points: 1 }] },
      }),
    ).toBe("ppr");
    expect(
      scoringSlugFromLeague({
        sport: "football",
        settings: { scoring_format: [{ abbr: "REC", points: 0 }] },
      }),
    ).toBe("standard");
    expect(
      scoringSlugFromLeague({ sport: "football", settings: {} }),
    ).toBe("ppr");
    expect(
      scoringSlugFromLeague({
        sport: "football",
        settings: { scoring_format: [{ abbr: "REC", points: 0.5 }] },
      }),
    ).toBe("ppr");
    expect(
      usesHalfPprScoringFallback({
        sport: "football",
        settings: { scoring_format: [{ abbr: "REC", points: 0.5 }] },
      }),
    ).toBe(true);
    expect(
      usesHalfPprScoringFallback({
        sport: "football",
        settings: { scoring_format: [{ abbr: "REC", points: 1 }] },
      }),
    ).toBe(false);
    expect(receptionPoints({ scoring_format: [{ label: "Each Reception", points: 0.5 }] })).toBe(0.5);
  });

  it("tries league season then prior for projection files", () => {
    expect(projectionSeasonCandidates(2026)).toEqual([2026, 2025]);
    expect(projectionSeasonCandidates(2025)).toEqual([2025, 2024]);
  });
});
