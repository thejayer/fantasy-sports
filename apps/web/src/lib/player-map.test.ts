import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("player map (roadmap 4.3)", () => {
  it("ships ESPN↔GSIS fixture rows for projection stars", () => {
    const fixture = path.resolve(
      __dirname,
      "../../../../fixtures/sj/player_map/2025.json",
    );
    const doc = JSON.parse(readFileSync(fixture, "utf8")) as {
      schema_version: number;
      season: number;
      mappings: Array<{ espn_id: string; player_id: string; name: string }>;
      coverage: { rostered: number; resolved: number; rate: number | null };
    };
    expect(doc.schema_version).toBe(1);
    expect(doc.season).toBe(2025);
    const byEspn = Object.fromEntries(doc.mappings.map((m) => [m.espn_id, m.player_id]));
    expect(byEspn["3139477"]).toBe("00-0033873"); // Mahomes
    expect(byEspn["3117251"]).toBe("00-0033280"); // CMC
    expect(byEspn["4262921"]).toBe("00-0036322"); // Jefferson

    const projections = JSON.parse(
      readFileSync(
        path.resolve(__dirname, "../../../../fixtures/sj/projections/ppr/2025.json"),
        "utf8",
      ),
    ) as { players: Array<{ player_id: string; player_name: string }> };
    const cmc = projections.players.find((p) => p.player_name === "Christian McCaffrey");
    expect(cmc?.player_id).toBe(byEspn["3117251"]);
  });

  it("exposes getPlayerMap next to other session-gated readers", () => {
    const source = readFileSync(path.resolve(__dirname, "data.ts"), "utf8");
    expect(source).toMatch(/export const getPlayerMap = cache/);
    expect(source).toContain('path.join("player_map", `${season}.json`)');
    expect(source).toMatch(/PlayerMapSnapshot/);
  });
});
