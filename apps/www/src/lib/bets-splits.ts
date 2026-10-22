/**
 * Record Splits board — mirrors `sj.bets_splits`.
 * Rows come from the sheet tab (header-detected sections), not from
 * re-aggregating Bets rows in the browser.
 */

import { KNOWN_BETTORS, uniqueBettors } from "@/lib/bets";

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

/** Map live display labels when Class key was missed (kind === "other"). */
export function coerceSplitKind(row: Pick<SplitRow, "kind" | "klass" | "source">): string {
  if (isSplitKind(row.kind)) return row.kind;
  const klass = (row.klass || "").toLowerCase().replace(/[−–—]/g, "-");
  const source = (row.source || "").toLowerCase();
  if (klass.includes("whole parlay") || klass === "parlay") return "ticket";
  const isProp = klass.includes("prop");
  const isTeam = klass.includes("team");
  const isLeg = source.includes("parlay") || klass.includes("leg");
  if (isLeg && isProp) return "leg_prop";
  if (isLeg && isTeam) return "leg_team";
  if (isProp) return "single_prop";
  if (isTeam) return "single_team";
  return row.kind || "other";
}

export function splitLabel(kind: string): string {
  if (isSplitKind(kind)) return SPLIT_LABELS[kind];
  return kind || "—";
}

export function displayWho(who: string): string {
  if (who === ALL_WHO) return "All bettors";
  return who;
}

/** Prefer Bettor key; fall back to ``Name (handle)`` when the live file used the display column. */
export function canonicalSplitWho(who: string): string {
  if (!who || who === ALL_WHO) return who;
  if (KNOWN_BETTORS[who]) return who;
  const match = who.match(/\(([^)]+)\)\s*$/);
  const handle = match?.[1]?.trim();
  if (handle && KNOWN_BETTORS[handle]) return handle;
  return who;
}

export function uniqueSplitBettors(rows: SplitRow[]): string[] {
  return uniqueBettors(
    rows
      .filter((row) => row.who && row.who !== ALL_WHO)
      .map((row) => ({ ...row, who: canonicalSplitWho(row.who) })),
  );
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
    if (who && canonicalSplitWho(row.who) !== who && row.who !== who) return false;
    if (sport && (row.sport || "").trim().toLowerCase() !== sport) return false;
    return true;
  });
}

export function withCoercedKind(row: SplitRow): SplitRow {
  const kind = coerceSplitKind(row);
  if (kind === row.kind) return row;
  const fadePlus = row.fade_1u != null && row.fade_1u > 0;
  return {
    ...row,
    kind,
    fade_plus: fadePlus,
    fade_emphasis: fadePlus && FADE_EMPHASIS.has(kind as SplitKind),
  };
}

export function orderedKinds(rows: SplitRow[]): SplitRow[] {
  const rank = new Map<string, number>(SPLIT_ORDER.map((kind, i) => [kind, i]));
  return [...rows].sort((a, b) => {
    const ak = coerceSplitKind(a);
    const bk = coerceSplitKind(b);
    const ai = rank.has(ak) ? (rank.get(ak) as number) : 99;
    const bi = rank.has(bk) ? (rank.get(bk) as number) : 99;
    return ai - bi || ak.localeCompare(bk);
  });
}

export function groupSplitsByWho(rows: SplitRow[]): Array<{ who: string; rows: SplitRow[] }> {
  const normalized = rows.map((row) => ({
    ...withCoercedKind(row),
    who: canonicalSplitWho(row.who),
  }));
  const names = [
    ...new Set(normalized.filter((row) => row.who === ALL_WHO).map((row) => row.who)),
    ...uniqueSplitBettors(normalized),
  ];
  return names
    .map((who) => ({
      who,
      rows: orderedKinds(
        normalized.filter((row) => row.who === who && isSplitKind(row.kind)),
      ),
    }))
    .filter((group) => group.rows.length > 0);
}

export function fadeTone(row: SplitRow): "edge" | "plus" | null {
  const coerced = withCoercedKind(row);
  if (
    coerced.fade_emphasis ||
    (coerced.fade_plus && FADE_EMPHASIS.has(coerced.kind as SplitKind))
  ) {
    return "edge";
  }
  if (coerced.fade_plus) return "plus";
  return null;
}
