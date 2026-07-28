/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ProjectionPlayer, Team } from "@/lib/data";

import { TradeAnalyzer } from "./TradeAnalyzer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/leagues/test",
  useSearchParams: () => new URLSearchParams("tab=tools&view=trade"),
}));

const mahomes: ProjectionPlayer = {
  player_id: "00-0033873",
  player_name: "Patrick Mahomes",
  position: "QB",
  team: "KC",
  points_mean: 320,
  points_sd: 40,
  floor: 280,
  median: 320,
  ceiling: 380,
  vor: 40,
  tier: 1,
};

const cmc: ProjectionPlayer = {
  player_id: "00-0033280",
  player_name: "Christian McCaffrey",
  position: "RB",
  team: "SF",
  points_mean: 280,
  points_sd: 50,
  floor: 220,
  median: 280,
  ceiling: 340,
  vor: 55,
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
    ],
  },
  {
    team_id: 2,
    name: "Bravo",
    abbrev: "BRA",
    owners: ["B"],
    wins: 0,
    losses: 0,
    ties: 0,
    points_for: 0,
    points_against: 0,
    standing: 2,
    division: "",
    roster: [
      {
        id: 201,
        name: "Christian McCaffrey",
        position: "RB",
        slot: "RB",
        pro_team: "SF",
        injury_status: null,
        total_points: null,
        projected_total_points: null,
        avg_points: null,
      },
    ],
  },
];

describe("TradeAnalyzer", () => {
  it("shows roster strength and evaluates a two-sided package", async () => {
    const user = userEvent.setup();
    render(
      <TradeAnalyzer
        teams={teams}
        espnToGsisEntries={[
          ["101", "00-0033873"],
          ["201", "00-0033280"],
        ]}
        projectionEntries={[
          ["00-0033873", mahomes],
          ["00-0033280", cmc],
        ]}
        initialA={1}
        initialB={2}
        leagueId="test"
        season={2025}
      />,
    );

    expect(
      screen.getByText(/Compare season projection totals/i),
    ).toBeTruthy();
    expect(screen.getByText(/Alpha roster strength/i)).toBeTruthy();
    expect(screen.getByText(/Bravo roster strength/i)).toBeTruthy();

    await user.click(
      screen.getByRole("checkbox", { name: "Offer Patrick Mahomes" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Offer Christian McCaffrey" }),
    );

    expect(screen.getByText(/Alpha after trade/i)).toBeTruthy();
    expect(screen.getByText(/Bravo after trade/i)).toBeTruthy();
  });
});
