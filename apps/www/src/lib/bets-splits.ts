/**
 * Record Splits board — mirrors `sj.bets_splits`.
 * Rows come from the sheet tab (header-detected sections), not from
 * re-aggregating Bets rows in the browser.
 */

import { uniqueBettors } from "@/lib/bets";

export const SPLIT_ORDER = [
  "single_team",
  "single_prop",
  "leg_team",
  "leg_prop",
  "ticket",
] as const;

export type SplitKind = (typeof SPLIT_ORDER)[number];

export const SPLIT_LABELS: Record<SplitKind, string> = {
  single_team: "Single team picks",
  single_prop: "Single player props",
  leg_team: "Parlay-leg team picks",
  leg_prop: "Parlay-leg player props",
  ticket: "Whole parlay tickets",
};

export const FADE_EMPHASIS = new Set<SplitKind>(["single_prop", "ticket"]);

export const ALL_WHO = "*";

export type SplitRow = {
  who: string;
  source: string;
  klass: string;
  kind: string;
  sport: string | null;
  section: string;
  n: number | null;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  unknown: number;
  record: string;
  win_pct: number | null;
  units_pl: number | null;
  pl: number | null;
  staked: number | null;
  flat_1u: number | null;
  fade_1u: number | null;
  fade_plus: boolean;
  fade_emphasis: boolean;
};

export type SplitCheck = {
  check: string;
  expected: string;
  actual: string;
  delta: string;
  status: string;
};

export type SplitsDocument = {
  synced_at?: string;
  source?: string;
  sheet_id?: string;
  tab?: string;
  split_count?: number;
  sport_count?: number;
  check_count?: number;
  splits: SplitRow[];
  sports: SplitRow[];
  checks: SplitCheck[];
  kinds?: string[];
  labels?: Record<string, string>;
};

export function isSplitKind(value: string): value is SplitKind {
  return (SPLIT_ORDER as readonly string[]).includes(value);
}

export function splitLabel(kind: string): string {
  if (isSplitKind(kind)) return SPLIT_LABELS[kind];
  return kind || "—";
}

export function displayWho(who: string): string {
  if (who === ALL_WHO) return "All bettors";
  return who;
}

export function uniqueSplitBettors(rows: SplitRow[]): string[] {
  return uniqueBettors(rows.filter((row) => row.who && row.who !== ALL_WHO));
}

export function uniqueSplitSports(rows: SplitRow[]): string[] {
  return [...new Set(rows.map((row) => row.sport).filter((s): s is string => Boolean(s)))].sort();
}

export function filterSplitRows(
  rows: SplitRow[],
  opts: { who?: string | null; sport?: string | null } = {},
): SplitRow[] {
  const who = opts.who || "";
  const sport = (opts.sport || "").trim().toLowerCase();
  return rows.filter((row) => {
    if (who && row.who !== who) return false;
    if (sport && (row.sport || "").trim().toLowerCase() !== sport) return false;
    return true;
  });
}

export function orderedKinds(rows: SplitRow[]): SplitRow[] {
  const rank = new Map<string, number>(SPLIT_ORDER.map((kind, i) => [kind, i]));
  return [...rows].sort((a, b) => {
    const ai = rank.has(a.kind) ? (rank.get(a.kind) as number) : 99;
    const bi = rank.has(b.kind) ? (rank.get(b.kind) as number) : 99;
    return ai - bi || a.kind.localeCompare(b.kind);
  });
}

export function groupSplitsByWho(rows: SplitRow[]): Array<{ who: string; rows: SplitRow[] }> {
  const names = [
    ...new Set(rows.filter((row) => row.who === ALL_WHO).map((row) => row.who)),
    ...uniqueSplitBettors(rows),
  ];
  return names
    .map((who) => ({
      who,
      rows: orderedKinds(rows.filter((row) => row.who === who && isSplitKind(row.kind))),
    }))
    .filter((group) => group.rows.length > 0);
}

export function fadeTone(row: SplitRow): "edge" | "plus" | null {
  if (row.fade_emphasis || (row.fade_plus && FADE_EMPHASIS.has(row.kind as SplitKind))) {
    return "edge";
  }
  if (row.fade_plus) return "plus";
  return null;
}
