import { describe, expect, it } from "vitest";

import type { LeagueSnapshot } from "@/lib/data";
import {
  formatRosterSlots,
  formatTradeDeadline,
  hasEspnSettings,
  keeperFacts,
  settingsGroups,
  totalRosterSize,
} from "@/lib/league-settings";

function league(partial: Partial<LeagueSnapshot> = {}): LeagueSnapshot {
  return {
    league_id: "demo",
    espn_league_id: 39790,
    sport: "football",
    format: "redraft",
    season: 2026,
    name: "Demo",
    team_count: 12,
    current_week: 14,
    period_label: "week",
    teams: [],
    players: [],
    ...partial,
  } as LeagueSnapshot;
}

describe("formatRosterSlots (roadmap 7.9)", () => {
  it("orders slots the way managers read them, not alphabetically", () => {
    expect(
      formatRosterSlots({ BE: 6, WR: 2, QB: 1, RB: 2, "D/ST": 1 }),
    ).toBe("QB 1 · RB 2 · WR 2 · D/ST 1 · BE 6");
  });

  it("drops zero and null slots instead of printing them", () => {
    expect(formatRosterSlots({ QB: 1, IR: 0, K: null })).toBe("QB 1");
  });

  it("returns null when nothing is configured", () => {
    expect(formatRosterSlots(undefined)).toBeNull();
    expect(formatRosterSlots({})).toBeNull();
    expect(formatRosterSlots({ QB: 0 })).toBeNull();
  });

  it("keeps unknown slot codes rather than hiding them", () => {
    expect(formatRosterSlots({ QB: 1, WEIRD: 3 })).toBe("QB 1 · WEIRD 3");
  });
});

describe("totalRosterSize", () => {
  it("sums configured slots", () => {
    expect(totalRosterSize({ QB: 1, RB: 2, BE: 6 })).toBe(9);
  });

  it("is null when the snapshot has no slot counts", () => {
    expect(totalRosterSize(undefined)).toBeNull();
    expect(totalRosterSize({})).toBeNull();
  });
});

describe("formatTradeDeadline", () => {
  it("treats a small number as a period", () => {
    expect(formatTradeDeadline(12)).toBe("week 12");
  });

  it("formats an epoch-ms timestamp as a date", () => {
    const ms = Date.UTC(2026, 10, 25);
    expect(formatTradeDeadline(ms)).toMatch(/2026/);
  });

  it("passes through something unusable rather than throwing", () => {
    expect(formatTradeDeadline(Number.NaN)).toBe("NaN");
  });
});

describe("keeperFacts", () => {
  it("derives keepers from ESPN settings, not the registry", () => {
    const facts = keeperFacts(
      league({ format: "dynasty", settings: { keeper_count: 4 } }),
    );
    expect(facts.espnKeepers).toBe(true);
    expect(facts.keeperCount).toBe(4);
    expect(facts.mismatch).toBe(false);
  });

  it("flags a registry/ESPN mismatch so the UI can say so", () => {
    const facts = keeperFacts(
      league({ format: "dynasty", settings: { keeper_count: 0 } }),
    );
    expect(facts.espnKeepers).toBe(false);
    expect(facts.declaredDynasty).toBe(true);
    expect(facts.mismatch).toBe(true);
  });

  it("does not claim a mismatch when ESPN reported nothing at all", () => {
    const facts = keeperFacts(league({ format: "dynasty", settings: {} }));
    expect(facts.keeperCount).toBeNull();
    expect(facts.mismatch).toBe(false);
  });
});

describe("settingsGroups", () => {
  it("drops groups with no readable rows rather than showing dashes", () => {
    const groups = settingsGroups(league({ settings: {} }));
    expect(groups.map((g) => g.title)).toEqual(["League"]);
  });

  it("still renders manifest-derived basics, which is why hasEspnSettings exists", () => {
    // The League group comes from the snapshot manifest, not settings.json, so
    // "groups is non-empty" is not evidence that ESPN reported any settings.
    const bare = league({ settings: {} });
    expect(settingsGroups(bare)).toHaveLength(1);
    expect(hasEspnSettings(bare)).toBe(false);
  });

  it("groups roster, playoffs, transactions, and scoring when present", () => {
    const groups = settingsGroups(
      league({
        settings: {
          scoring_type: "H2H_POINTS",
          reg_season_count: 14,
          playoff_team_count: 6,
          playoff_matchup_period_length: 2,
          faab: true,
          acquisition_budget: 100,
          trade_deadline: 12,
          veto_votes_required: 4,
          keeper_count: 0,
          position_slot_counts: { QB: 1, BE: 6 },
          scoring_format: [
            { abbr: "PTD", points: 4 },
            { abbr: "IGNORED", points: 0 },
          ],
        },
      }),
    );
    const byTitle = new Map(groups.map((g) => [g.title, g.rows]));
    expect([...byTitle.keys()]).toEqual([
      "League",
      "Roster",
      "Playoffs",
      "Transactions",
      "Scoring",
    ]);
    expect(byTitle.get("League")).toContainEqual({
      label: "Scoring type",
      value: "H2H Points",
    });
    expect(byTitle.get("Roster")).toEqual([
      { label: "Slots", value: "QB 1 · BE 6" },
      { label: "Roster size", value: "7" },
    ]);
    expect(byTitle.get("Playoffs")?.[1]).toEqual({
      label: "Round length",
      value: "2 weeks",
    });
    // A zero-point scoring rule is noise, not information.
    expect(byTitle.get("Scoring")).toEqual([{ label: "PTD", value: "4" }]);
    expect(byTitle.get("Transactions")).toContainEqual({
      label: "Keepers",
      value: "None (ESPN reports 0)",
    });
  });

  it("reads Season Points weights from categories when scoring_format is empty", () => {
    const groups = settingsGroups(
      league({
        sport: "baseball",
        scoring_type: "TOTAL_SEASON_POINTS",
        settings: {
          scoring_type: "TOTAL_SEASON_POINTS",
          categories: [
            { id: 5, abbr: "HR", label: "Home Runs", points: 5 },
            { id: 2, abbr: "AVG", label: "AVG", points: null },
          ],
        },
      }),
    );
    const byTitle = new Map(groups.map((g) => [g.title, g.rows]));
    expect(byTitle.get("League")).toContainEqual({
      label: "Scoring type",
      value: "Season Points",
    });
    expect(byTitle.get("Scoring")).toEqual([{ label: "HR", value: "5" }]);
  });

  it("does not treat golf-only settings as ESPN settings", () => {
    // Golf leagues nest their knobs under settings.golf and render their own
    // panel; that must not make a football season look synced.
    expect(
      hasEspnSettings(league({ settings: { golf: { roster: { starters: 5 } } } })),
    ).toBe(false);
    expect(hasEspnSettings(league({ settings: { playoff_team_count: 6 } }))).toBe(
      true,
    );
    expect(hasEspnSettings(league({ settings: undefined }))).toBe(false);
  });

  it("uses the league's period label for baseball", () => {
    const groups = settingsGroups(
      league({
        sport: "baseball",
        period_label: "period",
        settings: { reg_season_count: 22 },
      }),
    );
    const basics = groups.find((g) => g.title === "League")!.rows;
    expect(basics).toContainEqual({
      label: "Regular season",
      value: "22 periods",
    });
  });
});
