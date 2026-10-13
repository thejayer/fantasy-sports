/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AiRankingsBoard } from "@/components/AiRankingsBoard";
import type { AiRankingsSnapshot } from "@/lib/ai-rankings";

const snapshot: AiRankingsSnapshot = {
  schema_version: 1,
  board: "cfb",
  season: 2026,
  week: 7,
  week_label: "2026-w07",
  headline: "Buckeyes hold serve",
  methodology: "Results and margins.",
  last_week_review: "Alabama was the correction.",
  model: "fixture",
  rankings: [
    {
      rank: 1,
      name: "Ohio State",
      record: "2-0",
      blurb: "Beat Oregon at home.",
      delta: 0,
      ap_rank: 1,
      vs_ap: 0,
    },
    {
      rank: 2,
      name: "Alabama",
      record: "1-0",
      blurb: "Beat Georgia.",
      delta: 1,
      ap_rank: 3,
      vs_ap: -1,
    },
  ],
  movers: {
    risers: [
      { rank: 2, name: "Alabama", delta: 1, record: "1-0" },
    ],
    fallers: [],
    new: [],
    dropped: [],
  },
};

describe("AiRankingsBoard", () => {
  it("renders headline, review, and movers", () => {
    render(
      <AiRankingsBoard
        snapshot={snapshot}
        index={{ board: "cfb", latest: "2026-w07", weeks: ["2026-w06", "2026-w07"] }}
        hrefForWeek={(week) => `/rankings/cfb?week=${week}`}
        emptyTitle="empty"
        emptyBody="none"
        showAp
      />,
    );
    expect(screen.getByText("Buckeyes hold serve")).toBeTruthy();
    expect(screen.getByText(/Alabama was the correction/)).toBeTruthy();
    expect(screen.getByText("Ohio State")).toBeTruthy();
    expect(screen.getByText("Risers")).toBeTruthy();
    expect(screen.getByRole("link", { name: /2026 · W6/ })).toBeTruthy();
  });

  it("shows degraded empty copy when the board has no ranks", () => {
    render(
      <AiRankingsBoard
        snapshot={{
          ...snapshot,
          rankings: [],
          degraded: ["College Football Data API key missing."],
        }}
        index={null}
        hrefForWeek={(week) => week}
        emptyTitle="No CFB ballot this week"
        emptyBody="fallback"
      />,
    );
    expect(screen.getByText(/API key missing/)).toBeTruthy();
  });
});
