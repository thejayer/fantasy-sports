import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("hockey scope", () => {
  it("documents ESPN hockey + the NHL data layer in HUB and AGENTS", () => {
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
    expect(hub).toMatch(/1023106173/);
    expect(hub).toMatch(/`hockey-main` \| hockey \| redraft \| ESPN `1023106173` \| 2026–2027/);
    expect(hub).toMatch(/current_season/);
    expect(hub).toMatch(/hub 2027 \(2026–27, current/);
    expect(hub).toMatch(/HOCKEY-PORT\.md/);
    expect(hub).toMatch(/\{league\}\/\{season\}\/nhl\//);
    expect(hub).not.toMatch(/Do not add 2026/);
    expect(agents).toMatch(/hockey-main/);
    expect(agents).toMatch(/1023106173/);
    expect(agents).toMatch(/projection-free/);
    expect(agents).toMatch(/2027 \/ 2026–27/);
    expect(agents).toMatch(/SJ_NHL_SYNC=0/);
    expect(agents).not.toMatch(/Do not add 2026/);
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
