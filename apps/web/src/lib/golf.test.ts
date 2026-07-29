import { describe, expect, it } from "vitest";

import {
  buildGolfSnapshot,
  DEFAULT_GOLF_SETTINGS,
  validateCreateGolfLeague,
} from "./golf";

describe("golf create helpers", () => {
  it("accepts a playable create payload", () => {
    const input = {
      league_id: "golf-office",
      name: "Office Golf",
      season: 2026,
      format: "h2h" as const,
      team_count: 10,
      bench: 10,
      missed_cut: "alt1" as const,
      draft_style: "snake" as const,
      keepers: false,
      multipliers: { regular: 1, signature: 1.5, major: 2 },
    };
    expect(validateCreateGolfLeague(input)).toBeNull();
    const snap = buildGolfSnapshot(input);
    expect(snap.sport).toBe("golf");
    expect(snap.espn_league_id).toBeNull();
    expect(snap.teams).toHaveLength(10);
    expect(snap.settings.golf.roster.starters).toBe(
      DEFAULT_GOLF_SETTINGS.roster.starters,
    );
    expect(snap.settings.golf.missed_cut.mode).toBe("alt1");
    expect(snap.draft).toHaveLength(10 * 15);
    expect(snap.draft[0]?.player_name).toBe("Scottie Scheffler");
    expect(snap.teams[0]?.roster).toHaveLength(15);
    expect(snap.teams[0]?.roster.filter((p) => p.slot === "GS")).toHaveLength(5);
    expect(snap.scoreboard?.events).toHaveLength(2);
    expect(snap.scoreboard?.events[0]?.pairings.length).toBeGreaterThan(0);
    expect(snap.teams.some((t) => t.wins + t.losses + t.ties > 0)).toBe(true);
    expect(snap.teams[0]?.team_id).toBe(1);
    expect(Math.min(...snap.teams.map((t) => t.standing ?? 99))).toBe(1);
  });

  it("rejects out-of-range team counts and bad slugs", () => {
    expect(
      validateCreateGolfLeague({
        league_id: "Bad",
        name: "X",
        season: 2026,
        format: "h2h",
        team_count: 10,
        bench: 10,
        missed_cut: "off",
        draft_style: "snake",
        keepers: false,
        multipliers: { regular: 1, signature: 1.5, major: 2 },
      }),
    ).toMatch(/slug/i);
    expect(
      validateCreateGolfLeague({
        league_id: "golf-x",
        name: "X",
        season: 2026,
        format: "h2h",
        team_count: 3,
        bench: 10,
        missed_cut: "off",
        draft_style: "snake",
        keepers: false,
        multipliers: { regular: 1, signature: 1.5, major: 2 },
      }),
    ).toMatch(/team count/i);
  });
});
