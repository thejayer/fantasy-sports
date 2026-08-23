import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("hockey scope", () => {
  it("documents projection-free ESPN hockey in HUB and AGENTS", () => {
    const hub = readFileSync(
      path.resolve(__dirname, "../../../../HUB.md"),
      "utf8",
    );
    const agents = readFileSync(
      path.resolve(__dirname, "../../../../AGENTS.md"),
      "utf8",
    );
    expect(hub).toMatch(/Hockey scope/);
    expect(hub).toMatch(/hockey-main/);
    expect(hub).toMatch(/Projection-free by design/);
    expect(hub).toMatch(/espn_league_id.*0|league id TBD/i);
    expect(agents).toMatch(/hockey-main/);
    expect(agents).toMatch(/projection-free/);
  });

  it("keeps projection bundle load football-gated", () => {
    const page = readFileSync(
      path.resolve(__dirname, "../app/leagues/[leagueId]/page.tsx"),
      "utf8",
    );
    expect(page).toMatch(/wantsProjections/);
    expect(page).toMatch(/league\.sport === "football"/);
    expect(page).toMatch(/HockeyToolsPanel|hockeyToolsView/);
  });
});
