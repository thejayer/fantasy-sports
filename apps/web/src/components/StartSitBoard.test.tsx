/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ProjectionPlayer, Team } from "@/lib/data";

import { StartSitBoard } from "./StartSitBoard";

const weekly: ProjectionPlayer = {
  player_id: "00-0033873",
  player_name: "Patrick Mahomes",
  position: "QB",
  team: "KC",
  points_mean: 18.4,
  points_sd: 5.0,
  floor: 12.0,
  median: 18.2,
  ceiling: 26.0,
  vor: 4.1,
  tier: 1,
};

const teams: Team[] = [
  {
    team_id: 1,
    name: "Alpha",
    abbrev: "ALP",
    owners: ["A"],
    wins: 0,
    losses: 0,
    ties: 0,
    points_for: 0,
    points_against: 0,
    standing: 1,
    division: "",
    roster: [
      {
        id: 101,
        name: "Patrick Mahomes",
        position: "QB",
        slot: "QB",
        pro_team: "KC",
        injury_status: null,
        total_points: null,
        projected_total_points: null,
        avg_points: null,
      },
      {
        id: 102,
        name: "Bench WR",
        position: "WR",
        slot: "BE",
        pro_team: "MIN",
        injury_status: null,
        total_points: null,
        projected_total_points: null,
        avg_points: null,
      },
    ],
  },
];

describe("StartSitBoard", () => {
  it("lists mapped weekly medians and compares two picks", async () => {
    const user = userEvent.setup();
    render(
      <StartSitBoard
        teams={teams}
        espnToGsisEntries={[["101", "00-0033873"]]}
        weeklyEntries={[["00-0033873", weekly]]}
        initialTeamId={1}
      />,
    );
    expect(screen.getByText("Typical-week posteriors", { exact: false })).toBeTruthy();
    expect(screen.getByText("Patrick Mahomes")).toBeTruthy();
    await user.click(
      screen.getByRole("checkbox", { name: "Compare Patrick Mahomes" }),
    );
    expect(screen.getByRole("heading", { name: "Player A" })).toBeTruthy();
  });
});
