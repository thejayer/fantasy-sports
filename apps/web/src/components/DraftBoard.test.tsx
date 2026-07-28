/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DraftSimSnapshot } from "@/lib/data";

import { DraftBoard } from "./DraftBoard";

const snap: DraftSimSnapshot = {
  schema_version: 1,
  generated_at: "2025-08-01T00:00:00Z",
  scoring: "ppr",
  season: 2025,
  user_slot: 6,
  n_sims: 40,
  teams: 12,
  rounds: 15,
  pick_rates: [
    {
      player_id: "00-QB0005",
      player_name: "QB Fixture 6",
      position: "QB",
      pick_rate: 0.75,
      avg_round: 1.0,
      avg_value: 187.5,
      vor: 187.5,
    },
  ],
  availability: [
    {
      player_id: "00-QB0005",
      player_name: "QB Fixture 6",
      position: "QB",
      vor: 187.5,
      round_1: 0.9,
      round_2: 0.4,
    },
  ],
};

describe("DraftBoard", () => {
  it("renders pick rates and availability for the active slot", () => {
    render(
      <DraftBoard
        snapshot={snap}
        leagueId="test"
        season={2025}
        slot={6}
        availableSlots={[1, 6, 7, 12]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Who you land" })).toBeTruthy();
    expect(screen.getAllByText("QB Fixture 6").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: "Availability at your picks" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Slot 6" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Slot 2" })).toBeNull();
  });

  it("shows an empty state when the snapshot is missing", () => {
    render(
      <DraftBoard
        snapshot={null}
        leagueId="test"
        season={2025}
        slot={3}
        availableSlots={[1, 6]}
      />,
    );
    expect(
      screen.getByText("No draft-sim snapshot for this slot"),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Slot 1" })).toBeTruthy();
  });
});
