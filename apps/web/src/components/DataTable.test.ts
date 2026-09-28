import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("DataTable (roadmap 3.3)", () => {
  const dataTable = readFileSync(
    path.join(process.cwd(), "src/components/DataTable.tsx"),
    "utf8",
  );
  const playersBoard = readFileSync(
    path.join(process.cwd(), "src/components/PlayersBoard.tsx"),
    "utf8",
  );
  const leagueView = readFileSync(
    path.join(process.cwd(), "src/components/LeagueView.tsx"),
    "utf8",
  );

  it("is a narrow client component with search, filters, sort, and pagination", () => {
    expect(dataTable.startsWith('"use client"')).toBe(true);
    expect(dataTable).toMatch(/type="search"/);
    expect(dataTable).toMatch(/filter-chip/);
    expect(dataTable).toMatch(/aria-sort/);
    expect(dataTable).toMatch(/pageSize/);
    expect(dataTable).toMatch(/Previous/);
    expect(dataTable).toMatch(/Next/);
  });

  it("players tab uses a server PlayersBoard (roadmap 7.11 HTML budget)", () => {
    expect(playersBoard.startsWith('"use client"')).toBe(false);
    expect(playersBoard).toMatch(/export function PlayersBoard/);
    expect(playersBoard).toMatch(/queryPlayerTable/);
    expect(leagueView).toMatch(
      /import \{ PlayersBoard \} from "@\/components\/PlayersBoard"/,
    );
    expect(leagueView).toMatch(/<PlayersBoard/);
    expect(leagueView).not.toMatch(/FootballPlayersTable/);
    expect(leagueView).not.toMatch(/BaseballPlayersTable/);
    // LeagueView itself stays a server component.
    expect(leagueView.startsWith('"use client"')).toBe(false);
    // Baseball role switcher remains URL-driven on the server shell.
    expect(leagueView).toMatch(/RoleSwitcher/);
  });
});
