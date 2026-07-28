import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("projections UI (roadmap 4.4)", () => {
  it("team roster shows season floor/med/ceil joined via player map", () => {
    const source = readFileSync(
      path.resolve(
        __dirname,
        "../app/leagues/[leagueId]/teams/[teamId]/page.tsx",
      ),
      "utf8",
    );
    expect(source).toMatch(/getProjectionSnapshot/);
    expect(source).toMatch(/getPlayerMap/);
    expect(source).toMatch(/attachPlayerProjections/);
    expect(source).toMatch(/Floor/);
    expect(source).toMatch(/Med/);
    expect(source).toMatch(/Ceil/);
    expect(source).not.toMatch(/start\/sit/i);
  });

  it("ProjectionsBoard is season-level, not weekly start/sit", () => {
    const source = readFileSync(
      path.resolve(__dirname, "ProjectionsBoard.tsx"),
      "utf8",
    );
    expect(source).toMatch(/Season projections/);
    expect(source).toMatch(/not week-to-week start\/sit/);
    expect(source).toMatch(/VOR/);
    expect(source).toMatch(/"use client"/);
  });
});
