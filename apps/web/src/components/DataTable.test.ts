import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("DataTable (roadmap 3.3)", () => {
  const dataTable = readFileSync(
    path.join(process.cwd(), "src/components/DataTable.tsx"),
    "utf8",
  );
  const playersTable = readFileSync(
    path.join(process.cwd(), "src/components/PlayersDataTable.tsx"),
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

  it("players tab uses PlayersDataTable instead of inline sport tables", () => {
    expect(playersTable.startsWith('"use client"')).toBe(true);
    expect(playersTable).toMatch(/export function PlayersDataTable/);
    expect(leagueView).toMatch(
      /import \{ PlayersDataTable \} from "@\/components\/PlayersDataTable"/,
    );
    expect(leagueView).toMatch(/<PlayersDataTable/);
    expect(leagueView).not.toMatch(/FootballPlayersTable/);
    expect(leagueView).not.toMatch(/BaseballPlayersTable/);
    // LeagueView itself stays a server component.
    expect(leagueView.startsWith('"use client"')).toBe(false);
    // Baseball role switcher remains URL-driven on the server shell.
    expect(leagueView).toMatch(/RoleSwitcher/);
  });
});
