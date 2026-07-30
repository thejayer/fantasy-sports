import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { projectionCoverage } from "@/lib/projection-join";
import type { PlayerWithProjection } from "@/lib/projection-join";

function row(mapped: boolean): PlayerWithProjection {
  return {
    id: 1,
    name: "X",
    position: "QB",
    slot: "QB",
    pro_team: "KC",
    injury_status: null,
    total_points: 0,
    projected_total_points: null,
    avg_points: null,
    projection: mapped
      ? {
          player_id: "00-1",
          player_name: "X",
          position: "QB",
          team: "KC",
          points_mean: 1,
          points_sd: 1,
          floor: 1,
          median: 2,
          ceiling: 3,
          vor: 4,
          tier: 1,
        }
      : null,
  };
}

describe("projectionCoverage (roadmap 7.10)", () => {
  it("reports the join rate so a wall of dashes is explained", () => {
    expect(projectionCoverage([row(true), row(false), row(false), row(false)]))
      .toEqual({ mapped: 1, total: 4, rate: 0.25 });
  });

  it("reports zero coverage, which hides the quantile columns entirely", () => {
    expect(projectionCoverage([row(false), row(false)])).toEqual({
      mapped: 0,
      total: 2,
      rate: 0,
    });
  });

  it("does not divide by zero on an empty board", () => {
    expect(projectionCoverage([])).toEqual({ mapped: 0, total: 0, rate: 0 });
  });
});

describe("projection snapshots (roadmap 4.2)", () => {
  it("ships fixture JSON the hub reader can resolve", () => {
    const fixture = path.resolve(
      __dirname,
      "../../../../fixtures/sj/projections/ppr/2025.json",
    );
    const doc = JSON.parse(readFileSync(fixture, "utf8")) as {
      schema_version: number;
      scoring: string;
      season: number;
      players: Array<{ player_id: string; floor: number; median: number; ceiling: number }>;
    };
    expect(doc.schema_version).toBe(1);
    expect(doc.scoring).toBe("ppr");
    expect(doc.season).toBe(2025);
    expect(doc.players.length).toBeGreaterThan(0);
    const top = doc.players[0];
    expect(top.player_id).toBeTruthy();
    expect(top.floor).toBeLessThanOrEqual(top.median);
    expect(top.median).toBeLessThanOrEqual(top.ceiling);
  });

  it("exposes getProjectionSnapshot next to other session-gated readers", () => {
    const source = readFileSync(path.resolve(__dirname, "data.ts"), "utf8");
    expect(source).toMatch(/export const getProjectionSnapshot = cache/);
    expect(source).toContain('path.join("projections", slug, `${season}.json`)');
    expect(source).toMatch(/ProjectionSnapshot/);
  });
});
