import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("weekly projection snapshots (roadmap 4.5 start/sit)", () => {
  it("ships typical_week grain fixtures", () => {
    const fixture = path.resolve(
      __dirname,
      "../../../../fixtures/sj/weekly_projections/ppr/2025.json",
    );
    const doc = JSON.parse(readFileSync(fixture, "utf8")) as {
      schema_version: number;
      scoring: string;
      season: number;
      grain: string;
      players: Array<{ player_id: string }>;
    };
    expect(doc.grain).toBe("typical_week");
    expect(doc.season).toBe(2025);
    expect(doc.players.length).toBeGreaterThan(0);
  });

  it("rejects non-typical_week grain in getWeeklyProjectionSnapshot", () => {
    const source = readFileSync(path.resolve(__dirname, "data.ts"), "utf8");
    expect(source).toMatch(/export const getWeeklyProjectionSnapshot = cache/);
    expect(source).toContain('doc.grain === "typical_week"');
    expect(source).toContain(
      'path.join("weekly_projections", slug, `${season}.json`)',
    );
  });
});
