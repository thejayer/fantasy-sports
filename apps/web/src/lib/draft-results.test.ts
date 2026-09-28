import { describe, expect, it } from "vitest";

import type { DraftPick, Team } from "@/lib/data";
import {
  draftHasBids,
  draftHasKeepers,
  draftResultRows,
  isKeeperPlayer,
  keeperPlayerIds,
  sortDraftPicks,
} from "@/lib/draft-results";

const teams: Team[] = [
  {
    team_id: 1,
    name: "Alpha",
    abbrev: "ALP",
    owners: [],
    wins: 0,
    losses: 0,
    ties: 0,
    points_for: 0,
    points_against: 0,
    standing: 1,
    division: "",
    roster: [],
  },
  {
    team_id: 2,
    name: "Bravo",
    abbrev: "BRA",
    owners: [],
    wins: 0,
    losses: 0,
    ties: 0,
    points_for: 0,
    points_against: 0,
    standing: 2,
    division: "",
    roster: [],
  },
];

const picks: DraftPick[] = [
  {
    round: 2,
    round_pick: 1,
    team_id: 2,
    player_id: 20,
    player_name: "Second",
    bid_amount: 5,
    keeper: false,
    nominating_team_id: null,
  },
  {
    round: 1,
    round_pick: 1,
    team_id: 1,
    player_id: 10,
    player_name: "First",
    bid_amount: 0,
    keeper: true,
    nominating_team_id: null,
  },
];

describe("draft-results helpers", () => {
  it("sorts by round then pick", () => {
    const sorted = sortDraftPicks(picks);
    expect(sorted.map((p) => p.player_name)).toEqual(["First", "Second"]);
  });

  it("filters by team and resolves names", () => {
    const rows = draftResultRows({ draft: picks, teams }, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].teamName).toBe("Alpha");
    expect(rows[0].player_name).toBe("First");
  });

  it("detects bids and keepers", () => {
    expect(draftHasBids(picks)).toBe(true);
    expect(draftHasKeepers(picks)).toBe(true);
    expect(draftHasBids([{ ...picks[1], bid_amount: 0 }])).toBe(false);
  });

  it("indexes keeper player ids for roster badges", () => {
    const all = keeperPlayerIds(picks);
    expect([...all]).toEqual(["10"]);
    expect(isKeeperPlayer(10, all)).toBe(true);
    expect(isKeeperPlayer("10", all)).toBe(true);
    expect(isKeeperPlayer(20, all)).toBe(false);

    const team1 = keeperPlayerIds(picks, 1);
    expect([...team1]).toEqual(["10"]);
    expect(keeperPlayerIds(picks, 2).size).toBe(0);
  });
});
