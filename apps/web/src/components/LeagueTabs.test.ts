import { describe, expect, it } from "vitest";

import { splitTabs, tabLabel, type LeagueTab } from "@/components/LeagueTabs";
import { visibleSeasons } from "@/components/SeasonSwitcher";

function tabs(...ids: string[]): LeagueTab[] {
  return ids.map((id) => ({ id, label: tabLabel(id), href: `?tab=${id}` }));
}

const FOOTBALL = tabs(
  "standings",
  "teams",
  "players",
  "matchups",
  "draft",
  "activity",
  "history",
  "projections",
  "tools",
  "settings",
);

describe("tabLabel (roadmap 7.5)", () => {
  it("writes real labels instead of route slugs", () => {
    expect(tabLabel("standings")).toBe("Standings");
    expect(tabLabel("activity")).toBe("Feed");
    expect(tabLabel("start-sit")).toBe("Start-sit");
    expect(tabLabel("scoreboard")).toBe("Scoreboard");
  });

  it("title-cases an unknown id rather than dropping it", () => {
    expect(tabLabel("newthing")).toBe("Newthing");
  });
});

describe("splitTabs", () => {
  it("keeps the everyday tabs visible and files the rest", () => {
    const { shown, hidden } = splitTabs(FOOTBALL, "standings");
    expect(shown.map((t) => t.id)).toEqual([
      "standings",
      "teams",
      "players",
      "matchups",
      "activity",
      "tools",
    ]);
    expect(hidden.map((t) => t.id)).toEqual([
      "draft",
      "history",
      "projections",
      "settings",
    ]);
  });

  it("cuts the visible row to at most 7 pills including the disclosure", () => {
    const { shown, hidden } = splitTabs(FOOTBALL, "standings");
    expect(shown.length + (hidden.length ? 1 : 0)).toBeLessThanOrEqual(7);
  });

  it("promotes the active tab out of the overflow so it looks selected", () => {
    const { shown, hidden } = splitTabs(FOOTBALL, "history");
    expect(shown.map((t) => t.id)).toContain("history");
    expect(hidden.map((t) => t.id)).not.toContain("history");
  });

  it("preserves declared order when promoting", () => {
    const { shown } = splitTabs(FOOTBALL, "draft");
    expect(shown.map((t) => t.id)).toEqual([
      "standings",
      "teams",
      "players",
      "matchups",
      "draft",
      "activity",
      "tools",
    ]);
  });

  it("has no overflow when every tab is primary", () => {
    const { shown, hidden } = splitTabs(tabs("standings", "teams"), "teams");
    expect(shown).toHaveLength(2);
    expect(hidden).toEqual([]);
  });

  it("keeps the golf lane's week-to-week tabs visible", () => {
    const golf = tabs(
      "standings",
      "teams",
      "settings",
      "schedule",
      "lineup",
      "scoreboard",
      "draft",
      "auction",
      "history",
    );
    const { shown } = splitTabs(golf, "standings");
    expect(shown.map((t) => t.id)).toEqual([
      "standings",
      "teams",
      "schedule",
      "lineup",
      "scoreboard",
    ]);
  });
});

describe("visibleSeasons (roadmap 7.5)", () => {
  const twelve = [
    2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015,
  ];

  it("shows the four most recent seasons and hides the rest", () => {
    const { shown, hidden } = visibleSeasons(twelve, 2026);
    expect(shown).toEqual([2026, 2025, 2024, 2023]);
    expect(hidden).toHaveLength(8);
  });

  it("cuts twelve chips down to five including the disclosure", () => {
    const { shown, hidden } = visibleSeasons(twelve, 2026);
    expect(shown.length + (hidden.length ? 1 : 0)).toBe(5);
  });

  it("keeps an older viewed season visible", () => {
    const { shown, hidden } = visibleSeasons(twelve, 2017);
    expect(shown).toContain(2017);
    expect(hidden).not.toContain(2017);
    expect(shown).toHaveLength(4);
  });

  it("does not duplicate a season across shown and hidden", () => {
    const { shown, hidden } = visibleSeasons(twelve, 2018);
    const all = [...shown, ...hidden];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(twelve.length);
  });

  it("leaves short season lists alone", () => {
    expect(visibleSeasons([2026, 2025], 2026)).toEqual({
      shown: [2026, 2025],
      hidden: [],
    });
  });
});
