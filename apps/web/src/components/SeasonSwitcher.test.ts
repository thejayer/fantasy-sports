import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Roadmap 3.2: season chips on league AND team pages.
 */
describe("season navigation everywhere", () => {
  const switcherSource = readFileSync(
    path.join(process.cwd(), "src/components/SeasonSwitcher.tsx"),
    "utf8",
  );
  const leagueViewSource = readFileSync(
    path.join(process.cwd(), "src/components/LeagueView.tsx"),
    "utf8",
  );
  const baseballRosterSource = readFileSync(
    path.join(process.cwd(), "src/components/BaseballRosterView.tsx"),
    "utf8",
  );
  const teamPageSource = readFileSync(
    path.join(process.cwd(), "src/app/leagues/[leagueId]/teams/[teamId]/page.tsx"),
    "utf8",
  );

  it("exports a shared SeasonSwitcher driven by hrefFor", () => {
    expect(switcherSource).toMatch(/export function SeasonSwitcher/);
    expect(switcherSource).toMatch(/hrefFor/);
    expect(switcherSource).toMatch(/season-chip/);
    expect(switcherSource).toMatch(/seasons\.length <= 1/);
  });

  it("member home uses the shared switcher for a global year filter", () => {
    const home = readFileSync(
      path.join(process.cwd(), "src/components/MemberDashboard.tsx"),
      "utf8",
    );
    expect(home).toMatch(
      /import \{ SeasonSwitcher \} from "@\/components\/SeasonSwitcher"/,
    );
    expect(home).toMatch(/hrefFor=\{\(year\) => `\/\?season=\$\{year\}`\}/);
  });

  it("league view reuses the shared switcher", () => {
    expect(leagueViewSource).toMatch(
      /import \{ SeasonSwitcher \} from "@\/components\/SeasonSwitcher"/,
    );
    expect(leagueViewSource).not.toMatch(/function SeasonSwitcher\(/);
    expect(leagueViewSource).toMatch(/hrefFor=\{/);
  });

  it("team pages load seasons and render chips for both sports", () => {
    expect(teamPageSource).toMatch(/getLeagueSeasons/);
    expect(teamPageSource).toMatch(
      /import \{ SeasonSwitcher \} from "@\/components\/SeasonSwitcher"/,
    );
    expect(teamPageSource).toMatch(/seasons=\{seasons\}/);
    // Football back-link must preserve the viewed season.
    expect(teamPageSource).toMatch(
      /href=\{`\/leagues\/\$\{leagueId\}\?season=\$\{league\.season\}`\}/,
    );
    expect(baseballRosterSource).toMatch(
      /import \{ SeasonSwitcher \} from "@\/components\/SeasonSwitcher"/,
    );
    expect(baseballRosterSource).toMatch(/seasons: number\[\]/);
    expect(baseballRosterSource).toMatch(/\/teams\/\$\{team\.team_id\}\?season=/);
  });
});
