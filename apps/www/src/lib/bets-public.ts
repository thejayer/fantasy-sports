/**
 * BetMGM Public Warnings math — mirrors `sj.bets_public`.
 */

import {
  type BetWindow,
  FADE_AMERICAN,
  FADE_STAKE,
  fadePl,
  invertResult,
  inWindow,
  normalizeResult,
} from "@/lib/bets";

export type PublicWarning = {
  id: string;
  posted: string | null;
  url: string;
  gd: string | null;
  dow: string;
  sport: string;
  matchup: string;
  market: string;
  public_side: string;
  line: string;
  ticket: number | null;
  handle: number | null;
  wording: string;
  prime: string;
  slot: string;
  score: string;
  public_res: string;
  mgm_res: string;
  fade_res: string;
  bucket: string;
  src: string;
  notes: string;
  fade_pl: number | null;
};

export type PublicDocument = {
  synced_at?: string;
  source?: string;
  sheet_id?: string;
  tab?: string;
  warning_count?: number;
  warnings: PublicWarning[];
};

export type PublicKpis = {
  warnings: number;
  publicWins: number;
  publicLosses: number;
  publicPushes: number;
  publicPending: number;
  publicRecord: string;
  publicWinPct: number | null;
  mgmWins: number;
  mgmLosses: number;
  mgmPushes: number;
  mgmPending: number;
  mgmRecord: string;
  mgmWinPct: number | null;
  fadeWins: number;
  fadeLosses: number;
  fadePushes: number;
  fadeRecord: string;
  fadeWinPct: number | null;
  fadePl: number | null;
  fadeN: number;
  fadeAmerican: number;
  fadeStake: number;
  fadeRoi: number | null;
};

export type PublicBreakdownRow = PublicKpis & { key: string };

function ratio(num: number, den: number): number | null {
  if (den === 0) return null;
  return num / den;
}

function countResults(rows: PublicWarning[], field: "public_res" | "mgm_res" | "fade_res") {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let pending = 0;
  let unknown = 0;
  for (const row of rows) {
    const res = normalizeResult(row[field]);
    if (res === "W") wins += 1;
    else if (res === "L") losses += 1;
    else if (res === "Push") pushes += 1;
    else if (res === "Pending") pending += 1;
    else unknown += 1;
  }
  return { wins, losses, pushes, pending, unknown };
}

export function publicPrimeBucket(row: PublicWarning): string {
  const key = (row.prime || "").trim().toUpperCase();
  if (key === "Y") return "Prime time";
  if (key === "N") return "Not prime";
  return "Unknown";
}

export function publicKpis(warnings: PublicWarning[]): PublicKpis {
  const publicSide = countResults(warnings, "public_res");
  const mgm = countResults(warnings, "mgm_res");
  const fade = countResults(warnings, "fade_res");
  let pl = 0;
  let plN = 0;
  for (const row of warnings) {
    const dollar = row.fade_pl ?? fadePl(row.fade_res || invertResult(row.public_res));
    if (dollar == null) continue;
    pl += dollar;
    plN += 1;
  }
  return {
    warnings: warnings.length,
    publicWins: publicSide.wins,
    publicLosses: publicSide.losses,
    publicPushes: publicSide.pushes,
    publicPending: publicSide.pending,
    publicRecord: `${publicSide.wins}-${publicSide.losses}-${publicSide.pushes}`,
    publicWinPct: ratio(publicSide.wins, publicSide.wins + publicSide.losses),
    mgmWins: mgm.wins,
    mgmLosses: mgm.losses,
    mgmPushes: mgm.pushes,
    mgmPending: mgm.pending,
    mgmRecord: `${mgm.wins}-${mgm.losses}-${mgm.pushes}`,
    mgmWinPct: ratio(mgm.wins, mgm.wins + mgm.losses),
    fadeWins: fade.wins,
    fadeLosses: fade.losses,
    fadePushes: fade.pushes,
    fadeRecord: `${fade.wins}-${fade.losses}-${fade.pushes}`,
    fadeWinPct: ratio(fade.wins, fade.wins + fade.losses),
    fadePl: plN ? pl : null,
    fadeN: plN,
    fadeAmerican: FADE_AMERICAN,
    fadeStake: FADE_STAKE,
    fadeRoi: plN ? ratio(pl, FADE_STAKE * plN) : null,
  };
}

export function publicBreakdown(
  warnings: PublicWarning[],
  keyFn: (row: PublicWarning) => string,
): PublicBreakdownRow[] {
  const groups = new Map<string, PublicWarning[]>();
  for (const row of warnings) {
    const key = keyFn(row) || "—";
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, items]) => ({ key, ...publicKpis(items) }))
    .sort((a, b) => b.warnings - a.warnings || a.key.localeCompare(b.key));
}

export function filterWarnings(
  warnings: PublicWarning[],
  opts: { sport?: string | null; window?: BetWindow } = {},
): PublicWarning[] {
  const sport = (opts.sport || "").trim().toLowerCase();
  const window = opts.window ?? "all";
  return warnings.filter((row) => {
    if (sport && (row.sport || "").trim().toLowerCase() !== sport) return false;
    if (!inWindow({ gd: row.gd, posted: row.posted }, window)) return false;
    return true;
  });
}

export function uniqueWarningSports(warnings: PublicWarning[]): string[] {
  return [...new Set(warnings.map((row) => row.sport).filter(Boolean))].sort();
}

export function recentWarnings(warnings: PublicWarning[], limit = 40): PublicWarning[] {
  return [...warnings]
    .sort((a, b) => {
      const ap = a.posted || "";
      const bp = b.posted || "";
      if (ap !== bp) return bp.localeCompare(ap);
      return (b.id || "").localeCompare(a.id || "");
    })
    .slice(0, limit);
}
