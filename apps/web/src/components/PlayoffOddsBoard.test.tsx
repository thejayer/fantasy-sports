/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PlayoffOddsSnapshot } from "@/lib/data";

import { PlayoffOddsBoard } from "./PlayoffOddsBoard";

const snap: PlayoffOddsSnapshot = {
  schema_version: 1,
  generated_at: "2025-08-01T00:00:00Z",
  league_id: "football-main",
  season: 2026,
  scoring: "ppr",
  n_sims: 100,
  as_of_week: 10,
  playoff_team_count: 4,
  periods_simulated: [11, 12, 13],
  teams: [
    {
      team_id: 1,
      name: "Hail Mary Heroes",
      standing_now: 1,
      wins_now: 8,
      losses_now: 2,
      ties_now: 0,
      make_playoffs: 0.92,
      avg_wins: 11.2,
      seed_probs: { "1": 0.4, "2": 0.3, "3": 0.15, "4": 0.07 },
      mapped_roster: 8,
      rostered: 15,
    },
  ],
};

describe("PlayoffOddsBoard", () => {
  it("renders make-playoffs probs and seed columns", () => {
    render(<PlayoffOddsBoard snapshot={snap} />);
    expect(screen.getByText(/Make-playoffs Monte Carlo/i)).toBeTruthy();
    expect(screen.getByText("Hail Mary Heroes")).toBeTruthy();
    expect(screen.getByText("92%")).toBeTruthy();
    expect(screen.getByText("Seed 1")).toBeTruthy();
    expect(screen.getByText("8/15")).toBeTruthy();
  });

  it("shows empty state when snapshot is missing", () => {
    render(<PlayoffOddsBoard snapshot={null} />);
    expect(screen.getByText("No playoff-odds snapshot")).toBeTruthy();
    expect(screen.getByText(/export-playoff-odds/)).toBeTruthy();
  });

  it("discloses standings-locked when no periods remain", () => {
    render(
      <PlayoffOddsBoard
        snapshot={{ ...snap, periods_simulated: [], teams: snap.teams }}
      />,
    );
    expect(
      screen.getByText(/probabilities are locked to current standings/i),
    ).toBeTruthy();
  });
});
