import { describe, expect, it } from "vitest";

import { leagueRows, type LinksView } from "./profile-links";

const leagues = [
  {
    league: "l1",
    name: "League One",
    teams: [
      { team: "a", label: "Alpha", owner: "Ann" },
      { team: "b", label: "Bravo", owner: "Bo" },
      { team: "c", label: "Charlie", owner: "Cy" },
    ],
  },
  { league: "l2", name: "League Two", teams: [{ team: "x", label: "Xray", owner: "Xi" }] },
];

const view = (over: Partial<LinksView>): LinksView => ({ mod: false, links: [], taken: [], leagues, ...over });

describe("leagueRows", () => {
  it("marks every team open when nothing is linked or taken", () => {
    const rows = leagueRows(view({}));
    expect(rows[0]?.teams.map((t) => t.state)).toEqual(["open", "open", "open"]);
    expect(rows[0]?.openCount).toBe(3);
    expect(rows[0]?.mine).toBeNull();
  });

  it("separates mine, taken and locked", () => {
    const rows = leagueRows(
      view({
        links: [{ league: "l1", leagueName: "League One", team: "a", label: "Alpha", owner: "Ann", since: 1 }],
        taken: [
          { league: "l1", team: "a", mine: true },
          { league: "l1", team: "b", mine: false },
        ],
      }),
    );
    expect(rows[0]?.teams.map((t) => [t.team, t.state])).toEqual([
      ["a", "mine"],
      ["b", "taken"],
      ["c", "locked"],
    ]);
    expect(rows[0]?.mine?.team).toBe("a");
    expect(rows[0]?.openCount).toBe(1);
    // A link in one league does not lock another.
    expect(rows[1]?.teams[0]?.state).toBe("open");
  });

  it("is empty when the team list is unavailable", () => {
    expect(leagueRows(view({ leagues: undefined }))).toEqual([]);
  });
});
