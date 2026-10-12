/**
 * Parlay Legs math — mirrors `sj.bets_parlay`.
 */

import {
  invertResult,
  isBlank,
  normalizeResult,
  uniqueBettors,
} from "@/lib/bets";

export type ParlayLeg = {
  id: string;
  who: string;
  parent: string;
  n: number | null;
  url: string;
  posted: string | null;
  gd: string | null;
  dow: string;
  prime: string;
  slot: string;
  sport: string;
  lg: string;
  leg_type: string;
  pick: string;
  player: string;
  sel: string;
  stat: string;
  line: string;
  dir: string;
  opp: string;
  res: string;
  actual: string;
  src: string;
  fade_side: string;
  fade: string;
  parent_res: string;
  parent_bt: string;
  parent_n: string;
  parent_lost: string;
  odds: string;
  notes: string;
  ou: string;
};

export type ParlayDocument = {
  synced_at?: string;
  source?: string;
  sheet_id?: string;
  tab?: string;
  leg_count?: number;
  legs: ParlayLeg[];
  bettors?: string[];
};

export type ParlayKpis = {
  who: string | null;
  legs: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  unknown: number;
  voids: number;
  record: string;
  hitRate: number | null;
  fadeWins: number;
  fadeLosses: number;
  fadePushes: number;
  fadeRecord: string;
  fadeHitRate: number | null;
};

export type ParlayBreakdownRow = ParlayKpis & { key: string };

function ratio(num: number, den: number): number | null {
  if (den === 0) return null;
  return num / den;
}

function countResults(rows: ParlayLeg[], field: "res" | "fade") {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let pending = 0;
  let unknown = 0;
  let voids = 0;
  for (const row of rows) {
    const res = normalizeResult(row[field]);
    if (res === "W") wins += 1;
    else if (res === "L") losses += 1;
    else if (res === "Push") pushes += 1;
    else if (res === "Pending") pending += 1;
    else if (res.toLowerCase() === "void") voids += 1;
    else unknown += 1;
  }
  return { wins, losses, pushes, pending, unknown, voids };
}

export function ouBucket(direction: string): string {
  const key = (direction || "").trim().toLowerCase();
  if (key === "over" || key === "o") return "Over";
  if (key === "under" || key === "u") return "Under";
  if (!key) return "—";
  return "Other";
}

export function parlayPrimeBucket(leg: ParlayLeg): string {
  const key = (leg.prime || "").trim().toUpperCase();
  if (key === "Y") return "Prime time";
  if (key === "N") return "Not prime";
  return "Unknown";
}

export function parlayKpis(legs: ParlayLeg[], who?: string | null): ParlayKpis {
  const rows = who ? legs.filter((leg) => leg.who === who) : legs;
  const hit = countResults(rows, "res");
  const fade = countResults(rows, "fade");
  return {
    who: who ?? null,
    legs: rows.length,
    wins: hit.wins,
    losses: hit.losses,
    pushes: hit.pushes,
    pending: hit.pending,
    unknown: hit.unknown,
    voids: hit.voids,
    record: `${hit.wins}-${hit.losses}-${hit.pushes}`,
    hitRate: ratio(hit.wins, hit.wins + hit.losses),
    fadeWins: fade.wins,
    fadeLosses: fade.losses,
    fadePushes: fade.pushes,
    fadeRecord: `${fade.wins}-${fade.losses}-${fade.pushes}`,
    fadeHitRate: ratio(fade.wins, fade.wins + fade.losses),
  };
}

export function parlayBreakdown(
  legs: ParlayLeg[],
  keyFn: (leg: ParlayLeg) => string,
): ParlayBreakdownRow[] {
  const groups = new Map<string, ParlayLeg[]>();
  for (const leg of legs) {
    const key = keyFn(leg) || "—";
    const list = groups.get(key) ?? [];
    list.push(leg);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, items]) => ({ key, ...parlayKpis(items), who: null }))
    .sort((a, b) => b.legs - a.legs || a.key.localeCompare(b.key));
}

export function filterParlayLegs(
  legs: ParlayLeg[],
  opts: { who?: string | null; sport?: string | null } = {},
): ParlayLeg[] {
  const who = opts.who || "";
  const sport = (opts.sport || "").trim().toLowerCase();
  return legs.filter((leg) => {
    if (who && leg.who !== who) return false;
    if (sport && (leg.sport || "").trim().toLowerCase() !== sport) return false;
    return true;
  });
}

export function uniqueParlaySports(legs: ParlayLeg[]): string[] {
  return [...new Set(legs.map((leg) => leg.sport).filter(Boolean))].sort();
}

export function uniqueParlayBettors(legs: ParlayLeg[]): string[] {
  return uniqueBettors(legs);
}

export function recentLegs(legs: ParlayLeg[], limit = 40): ParlayLeg[] {
  return [...legs]
    .sort((a, b) => {
      const ap = a.posted || "";
      const bp = b.posted || "";
      if (ap !== bp) return bp.localeCompare(ap);
      return (b.id || "").localeCompare(a.id || "");
    })
    .slice(0, limit);
}

export function ensureFade(res: string, fade: string): string {
  if (!isBlank(fade)) return normalizeResult(fade);
  return invertResult(res);
}
