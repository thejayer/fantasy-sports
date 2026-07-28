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
    expect(viewSource).toMatch(/PlayersDataTable/);
    // Roadmap 3.4: matchups tab on the unified view.
    expect(viewSource).toMatch(/MatchupsPanel/);
    expect(viewSource).toMatch(/"matchups"/);
    // Roadmap 3.5: history tab aggregates multi-season archives.
    expect(viewSource).toMatch(/HistoryPanel/);
    expect(viewSource).toMatch(/"history"/);
  });
});
