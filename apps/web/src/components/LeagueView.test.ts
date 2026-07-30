import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Roadmap 3.1: one sport-aware LeagueView — football must not keep a parallel
 * inline branch on the league page, and must inherit season chips / Win%.
 */
describe("LeagueView unification", () => {
  const pageSource = readFileSync(
    path.join(process.cwd(), "src/app/leagues/[leagueId]/page.tsx"),
    "utf8",
  );
  const viewSource = readFileSync(
    path.join(process.cwd(), "src/components/LeagueView.tsx"),
    "utf8",
  );

  it("league page renders LeagueView for every sport", () => {
    expect(pageSource).toMatch(/import \{ LeagueView \} from "@\/components\/LeagueView"/);
    expect(pageSource).toMatch(/<LeagueView/);
    expect(pageSource).not.toMatch(/sport === "baseball"/);
    expect(pageSource).not.toMatch(/BaseballLeagueView/);
    expect(pageSource).not.toMatch(/function record\(/);
  });

  it("shared view includes season chips, win%, and sport-gated standings", () => {
    expect(viewSource).toMatch(/SeasonSwitcher/);
    expect(viewSource).toMatch(/Win%/);
    expect(viewSource).toMatch(/table-scroll/);
    expect(viewSource).toMatch(/sportFormatLabel/);
    // Football keeps PF/PA; baseball keeps role switcher; players use DataTable.
    expect(viewSource).toMatch(/"PF"/);
    expect(viewSource).toMatch(/<th>PA<\/th>/);
    expect(viewSource).toMatch(/RoleSwitcher/);
    expect(viewSource).toMatch(/PlayersBoard/);
    // Roadmap 3.4: matchups tab on the unified view.
    expect(viewSource).toMatch(/MatchupsPanel/);
    expect(viewSource).toMatch(/"matchups"/);
    // Roadmap 3.5: history tab aggregates multi-season archives.
    expect(viewSource).toMatch(/HistoryPanel/);
    expect(viewSource).toMatch(/"history"/);
    // Roadmap 4.4: football projections tab (VOR / floor / median / ceiling).
    expect(viewSource).toMatch(/ProjectionsBoard/);
    expect(viewSource).toMatch(/"projections"/);
    expect(viewSource).toMatch(/showProjections/);
    // Roadmap 4.5: decision tools tab (trade / waivers / strength).
    expect(viewSource).toMatch(/ToolsPanel/);
    expect(viewSource).toMatch(/"tools"/);
    // ESPN draft results + activity ledger (both sports); baseball FA board.
    expect(viewSource).toMatch(/DraftResultsPanel/);
    expect(viewSource).toMatch(/ActivityPanel/);
    expect(viewSource).toMatch(/"draft"/);
    expect(viewSource).toMatch(/"activity"/);
    expect(viewSource).toMatch(/FreeAgentsBoard/);
    expect(viewSource).toMatch(/"waivers"/);
    // Roadmap 4.6: baseball stays projection-free; 8.2 fills tools with arithmetic.
    expect(viewSource).toMatch(/BASEBALL_TABS/);
    expect(viewSource).toMatch(/projection-free by design/);
    expect(viewSource).toMatch(/Baseball stays projection-free by design/);
    expect(viewSource).toMatch(/BaseballToolsPanel/);
    expect(viewSource).not.toMatch(/Decision tools are football-only by design/);
    expect(viewSource).not.toMatch(/until roadmap 4\.6/);
    // Roadmap 6.4a–c: golf lane — settings, draft, lineup panel.
    expect(viewSource).toMatch(/GOLF_TABS/);
    expect(viewSource).toMatch(/GolfSettingsPanel/);
    expect(viewSource).toMatch(/GolfLineupPanel/);
    expect(viewSource).toMatch(/GolfScoreboardPanel/);
    expect(viewSource).toMatch(/isGolf/);
    expect(viewSource).not.toMatch(/Snake draft comes in 6\.4b/);
    expect(viewSource).not.toMatch(/Weekly lineups come in 6\.4c/);
    expect(viewSource).not.toMatch(/^["']use client["']/m);
  });

  it("league page loads projection snapshots for football tabs", () => {
    expect(pageSource).toMatch(/getProjectionSnapshot/);
    expect(pageSource).toMatch(/getPlayerMap/);
    expect(pageSource).toMatch(/scoringSlugFromLeague/);
    expect(pageSource).toMatch(/tab === "tools"/);
    expect(pageSource).toMatch(/league\.sport === "football"/);
  });
});
