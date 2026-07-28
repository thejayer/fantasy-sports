import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("baseball scope (roadmap 4.6)", () => {
  it("documents projection-free baseball in HUB and ROADMAP", () => {
    const hub = readFileSync(
      path.resolve(__dirname, "../../../../HUB.md"),
      "utf8",
    );
    const roadmap = readFileSync(
      path.resolve(__dirname, "../../../../ROADMAP.md"),
      "utf8",
    );
    expect(hub).toMatch(/Baseball scope \(roadmap 4\.6\)/);
    expect(hub).toMatch(/Projection-free by design/);
    expect(roadmap).toMatch(/4\.6 Baseball — LANDED/);
    expect(roadmap).toMatch(/keep baseball data-rich but projection-free/);
  });

  it("keeps projection bundle load football-gated", () => {
    const page = readFileSync(
      path.resolve(__dirname, "../app/leagues/[leagueId]/page.tsx"),
      "utf8",
    );
    expect(page).toMatch(
      /league\.sport === "football"[\s\S]*wantsProjections|wantsProjections[\s\S]*league\.sport === "football"/,
    );
  });
});
