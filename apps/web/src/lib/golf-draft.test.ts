import { describe, expect, it } from "vitest";

import {
  type DraftTeam,
  owgrPool,
  poolSizeForLeague,
  runSnakeDraft,
} from "./golf-draft";

describe("golf snake draft", () => {
  it("builds a stable OWGR pool", () => {
    const pool = owgrPool(60);
    expect(pool[0]).toMatchObject({
      id: 1,
      name: "Scottie Scheffler",
      owgr_rank: 1,
    });
    expect(pool[59]?.name).toBe("OWGR Golfer 60");
    expect(poolSizeForLeague(8, 5, 10)).toBeGreaterThanOrEqual(120 + 20);
  });

  it("snakes picks and fills GS then BE", () => {
    const teams: DraftTeam[] = [1, 2, 3, 4].map((team_id) => ({
      team_id,
      name: `Team ${team_id}`,
      roster: [],
    }));
    const { draft, players, free_agents } = runSnakeDraft(teams, {
      starters: 5,
      bench: 3,
    });
    expect(draft).toHaveLength(32);
    expect(draft[0]?.team_id).toBe(1);
    expect(draft[3]?.team_id).toBe(4); // end of round 1
    expect(draft[4]?.team_id).toBe(4); // round 2 snakes back to team 4
    expect(draft[5]?.team_id).toBe(3);
    expect(teams[0]?.roster.filter((p) => p.slot === "GS")).toHaveLength(5);
    expect(players).toHaveLength(32);
    expect(free_agents.length).toBeGreaterThan(0);
  });
});
