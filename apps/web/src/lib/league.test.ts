import { describe, expect, it } from "vitest";

import { injuryTone, recordLabel, sportFormatLabel, winPctLabel } from "@/lib/league";
import type { Player, Team } from "@/lib/data";

function player(partial: Partial<Player>): Player {
  return {
    id: 1,
    name: "Test",
    position: "QB",
    slot: "QB",
    pro_team: "KC",
    injury_status: null,
    total_points: 10,
    projected_total_points: 10,
    avg_points: 10,
    ...partial,
  };
}

function team(partial: Partial<Team>): Team {
  return {
    team_id: 1,
    name: "Testers",
    abbrev: "TST",
    owners: ["A"],
    wins: 10,
    losses: 4,
    ties: 0,
    points_for: 100,
    points_against: 90,
    standing: 1,
    division: "",
    roster: [],
    ...partial,
  };
}

describe("league helpers", () => {
  it("formats records and win percentage", () => {
    expect(recordLabel(team({ wins: 11, losses: 3, ties: 0 }))).toBe("11-3");
    expect(recordLabel(team({ wins: 8, losses: 5, ties: 1 }))).toBe("8-5-1");
    expect(winPctLabel(team({ win_pct: 0.733 }))).toBe(".733");
    expect(winPctLabel(team({ wins: 1, losses: 1, ties: 0, win_pct: null }))).toBe(".500");
  });

  it("maps football and baseball injury statuses", () => {
    expect(injuryTone(player({ injury_status: "ACTIVE" }))).toBe("ok");
    expect(injuryTone(player({ injury_status: "QUESTIONABLE" }))).toBe("warn");
    expect(injuryTone(player({ injury_status: "DOUBTFUL" }))).toBe("warn");
    expect(injuryTone(player({ injury_status: "OUT" }))).toBe("bad");
    expect(injuryTone(player({ injury_status: "INJURY_RESERVE" }))).toBe("bad");
    expect(injuryTone(player({ injury_status: "IR" }))).toBe("bad");
    expect(injuryTone(player({ injury_status: "IL" }))).toBe("bad");
    expect(injuryTone(player({ injured: true, injury_status: "ACTIVE" }))).toBe("bad");
  });

  it("builds sport · format kicker labels", () => {
    expect(sportFormatLabel("football", "redraft")).toBe("Football · Redraft");
    expect(sportFormatLabel("baseball", "dynasty")).toBe("Baseball · Dynasty");
  });
});
