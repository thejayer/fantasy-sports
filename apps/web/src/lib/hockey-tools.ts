/**
 * Projection-free hockey helpers. Snapshot arithmetic only — no NHL model / ffa.
 */

import type { LeagueSnapshot, Player, Team } from "@/lib/data";
import { isCategoryScoring, isSeasonPointsScoring } from "@/lib/scoring-type";

export type HockeyToolsView = "home" | "categories";

export const HOCKEY_TOOL_CARDS: Array<{
  id: Exclude<HockeyToolsView, "home">;
  name: string;
  promise: string;
  ready: boolean;
}> = [
  {
    id: "categories",
    name: "Category Board",
    promise: "Season-to-date skater/goalie counting ranks from roster stats.",
    ready: true,
  },
];

export type HockeyCategoryDef = {
  id: string;
  label: string;
  higherIsBetter: boolean;
  digits: number;
};

export const DEFAULT_HOCKEY_CATEGORIES: HockeyCategoryDef[] = [
  { id: "G", label: "G", higherIsBetter: true, digits: 0 },
  { id: "A", label: "A", higherIsBetter: true, digits: 0 },
  { id: "PPP", label: "PPP", higherIsBetter: true, digits: 0 },
  { id: "SOG", label: "SOG", higherIsBetter: true, digits: 0 },
  { id: "HIT", label: "HIT", higherIsBetter: true, digits: 0 },
  { id: "BLK", label: "BLK", higherIsBetter: true, digits: 0 },
  { id: "W", label: "W", higherIsBetter: true, digits: 0 },
  { id: "SV", label: "SV", higherIsBetter: true, digits: 0 },
  { id: "GAA", label: "GAA", higherIsBetter: false, digits: 2 },
];

export const HOCKEY_INVERT_KEYS = ["GAA", "GA", "L", "OTL"];

export function hockeyCategoriesForLeague(
  league: LeagueSnapshot,
): HockeyCategoryDef[] {
  const rows = [
    ...(league.settings?.categories ?? []),
    ...(league.settings?.scoring_format ?? []),
  ];
  const seen = new Set<string>();
  const fromSettings: HockeyCategoryDef[] = [];
  for (const row of rows) {
    const id = (row.abbr || row.label || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    fromSettings.push({
      id,
      label: row.abbr || row.label || id,
      higherIsBetter: !HOCKEY_INVERT_KEYS.includes(id),
      digits: id === "SV%" ? 3 : id === "GAA" ? 2 : 0,
    });
  }
  return fromSettings.length ? fromSettings : DEFAULT_HOCKEY_CATEGORIES;
}

export function sumHockeySeasonStats(team: Team): Record<string, number> {
  const out: Record<string, number> = {};
  for (const player of team.roster ?? []) {
    addPlayerHockeyStats(out, player);
  }
  return out;
}

function addPlayerHockeyStats(
  out: Record<string, number>,
  player: Player,
): void {
  const stats = player.season_stats;
  if (!stats) return;
  for (const [key, value] of Object.entries(stats)) {
    if (value == null || Number.isNaN(value)) continue;
    out[key] = (out[key] ?? 0) + value;
  }
}

export function rosterHasHockeyStats(league: LeagueSnapshot): boolean {
  return league.teams.some((team) =>
    (team.roster ?? []).some((player) => {
      const stats = player.season_stats;
      return stats != null && Object.keys(stats).length > 0;
    }),
  );
}

export type HockeyCategoryCell = {
  value: number | null;
  rank: number | null;
};

export type HockeyCategoryTeamRow = {
  teamId: number;
  name: string;
  cells: Record<string, HockeyCategoryCell>;
};

export type HockeyCategoryBoard = {
  categories: HockeyCategoryDef[];
  rows: HockeyCategoryTeamRow[];
  disclaimer: string;
};

export function buildHockeyCategoryBoard(
  league: LeagueSnapshot,
): HockeyCategoryBoard | null {
  if (!rosterHasHockeyStats(league)) return null;
  const categories = hockeyCategoriesForLeague(league);
  const totals = league.teams.map((team) => ({
    teamId: team.team_id,
    name: team.name,
    stats: sumHockeySeasonStats(team),
  }));
  const rows: HockeyCategoryTeamRow[] = totals.map((team) => {
    const cells: Record<string, HockeyCategoryCell> = {};
    for (const cat of categories) {
      const value = team.stats[cat.id];
      cells[cat.id] = {
        value: value == null || Number.isNaN(value) ? null : value,
        rank: null,
      };
    }
    return { teamId: team.teamId, name: team.name, cells };
  });
  for (const cat of categories) {
    const scored = rows
      .map((row) => ({ row, value: row.cells[cat.id]?.value }))
      .filter((item): item is { row: HockeyCategoryTeamRow; value: number } =>
        item.value != null,
      )
      .sort((a, b) =>
        cat.higherIsBetter ? b.value - a.value : a.value - b.value,
      );
    let i = 0;
    while (i < scored.length) {
      let j = i;
      while (j < scored.length && scored[j]!.value === scored[i]!.value) j += 1;
      const rank = i + 1;
      for (let k = i; k < j; k += 1) {
        scored[k]!.row.cells[cat.id]!.rank = rank;
      }
      i = j;
    }
  }
  return {
    categories,
    rows,
    disclaimer:
      "Season-to-date from synced roster counting stats. Not an NHL projection model and not ESPN period boxes.",
  };
}

export function hockeyToolsForScoring(
  scoringType: string | null | undefined,
): ReadonlyArray<"categories"> {
  if (isSeasonPointsScoring(scoringType)) return [];
  if (isCategoryScoring(scoringType)) return ["categories"];
  // H2H points still has counting ranks when season_stats exist.
  return ["categories"];
}

export function parseHockeyToolsView(
  raw: string | undefined | null,
): HockeyToolsView {
  return raw === "categories" ? "categories" : "home";
}
