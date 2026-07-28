import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
