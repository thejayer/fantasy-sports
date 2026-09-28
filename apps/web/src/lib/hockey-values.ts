/**
 * Hockey player values (HOCKEY-PORT.md H2) + durability / ROS (H3).
 *
 * `sj sync` / `sj nhl` write `{league}/{season}/nhl/values.json` from
 * `src/nhl/value.py`. Each player carries every input (`parts`) with its kind,
 * per-game value, base weight and games factor, so a different recent-form
 * setting re-blends here with the same formula — nothing is recomputed from
 * raw stats and the NHL is never called from the hub. Client-safe (no fs).
 */

export type HockeyValuePart = {
  kind: "trailing" | "season" | "projection" | "history" | "prospect" | "role";
  label: string;
  fpg: number;
  gp: number | null;
  base: number;
  games_factor: number;
};

export type HockeySource =
  | "current"
  | "history"
  | "rookie"
  | "rookie_playing"
  | "estimate";

export type HockeyPlayerValue = {
  espn_id: number;
  name: string | null;
  position: string | null;
  group: "F" | "D" | "G";
  pro_team: string | null;
  nhl_id: number | null;
  nhl_team: string | null;
  fantasy_team_id: number | null;
  rostered: boolean;
  injury_status: string | null;
  age: number | null;
  value: number | null;
  base: number | null;
  mult: number;
  adjustments: string[];
  parts: HockeyValuePart[];
  source: HockeySource;
  durability: { rate: number; basis: string; iron_man: boolean };
  remaining_games: number | null;
  ros: number | null;
  espn_proj: { total: number | null; gp: number; per_game: number | null } | null;
};

export type HockeyValuesSnapshot = {
  schema_version: number;
  league_id: string;
  season: number;
  sport: "hockey";
  nhl_season: string;
  generated_at: string;
  as_of: string;
  recent_default: number;
  scoring_source: string;
  weights: Record<string, number>;
  players: Record<string, HockeyPlayerValue>;
};

export const RECENT_DEFAULT = 0.5;

/** Mirror of `nhl.value.part_weight` — keep the two in lockstep. */
export function partWeight(part: HockeyValuePart, recent: number): number {
  switch (part.kind) {
    case "trailing":
      return part.base * recent * part.games_factor;
    case "projection":
      return 0.15 + 0.3 * (1 - recent);
    case "history":
      return (0.15 + 0.3 * (1 - recent)) * part.games_factor;
    case "season":
      return part.base * part.games_factor;
    default:
      return part.base;
  }
}

export type BlendedPart = HockeyValuePart & { weight: number; share: number };

/** Re-blend one player's inputs at `recent`; mirrors `nhl.value.blend`. */
export function reblend(
  player: HockeyPlayerValue,
  recent: number = RECENT_DEFAULT,
): { base: number | null; value: number | null; ros: number | null; parts: BlendedPart[] } {
  const parts = player.parts ?? [];
  if (!parts.length) return { base: null, value: null, ros: null, parts: [] };
  const weights = parts.map((p) => partWeight(p, recent));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const base =
    total > 0
      ? parts.reduce((sum, p, i) => sum + p.fpg * weights[i], 0) / total
      : parts.reduce((sum, p) => sum + p.fpg, 0) / parts.length;
  const value = base * (player.mult ?? 1);
  const ros =
    player.remaining_games != null
      ? value * player.remaining_games * (player.durability?.rate ?? 1)
      : null;
  return {
    base,
    value,
    ros,
    parts: parts.map((p, i) => ({
      ...p,
      weight: weights[i],
      share: total > 0 ? weights[i] / total : 1 / parts.length,
    })),
  };
}

/** `?recent=` → 0…1 in steps of 0.25 (default 0.5). */
export function parseRecent(raw: string | undefined | null): number {
  const n = Number(raw);
  if (raw == null || raw === "" || !Number.isFinite(n)) return RECENT_DEFAULT;
  return Math.round(Math.min(1, Math.max(0, n)) * 4) / 4;
}

export const RECENT_STEPS = [0, 0.25, 0.5, 0.75, 1] as const;

export function recentLabel(recent: number): string {
  if (recent <= 0) return "Track record";
  if (recent >= 1) return "Recent form";
  if (recent === 0.5) return "Balanced";
  return recent < 0.5 ? "Lean track record" : "Lean recent form";
}

export const SOURCE_LABELS: Record<HockeySource, string> = {
  current: "This season",
  history: "History",
  rookie: "Rookie",
  rookie_playing: "Rookie playing",
  estimate: "Role estimate",
};

export type HockeyBoardQuery = {
  pos: "all" | "F" | "D" | "G";
  who: "all" | "rostered" | "fa";
  sort: "value" | "ros" | "espn" | "durability" | "age" | "name";
  dir: "asc" | "desc";
  page: number;
  recent: number;
  /** ESPN id whose input breakdown is expanded (one at a time keeps HTML small). */
  open: string | null;
};

// 25 rows keeps the document under the 7.11 HTML budget (each row has two links).
export const HOCKEY_BOARD_PAGE_SIZE = 25;

export function parseHockeyBoardQuery(raw: {
  pos?: string;
  who?: string;
  sort?: string;
  dir?: string;
  p?: string;
  recent?: string;
  open?: string;
}): HockeyBoardQuery {
  const pos = (["F", "D", "G"] as const).find((p) => p === raw.pos) ?? "all";
  const who = (["rostered", "fa"] as const).find((w) => w === raw.who) ?? "all";
  const sort =
    (["ros", "espn", "durability", "age", "name"] as const).find((s) => s === raw.sort) ??
    "value";
  const dir = raw.dir === "asc" ? "asc" : raw.dir === "desc" ? "desc" : sort === "name" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(raw.p ?? "1", 10) || 1);
  const open = raw.open && /^\d+$/.test(raw.open) ? raw.open : null;
  return { pos, who, sort, dir, page, recent: parseRecent(raw.recent), open };
}

export type HockeyBoardRow = HockeyPlayerValue & {
  blended: ReturnType<typeof reblend>;
};

function sortKey(row: HockeyBoardRow, sort: HockeyBoardQuery["sort"]): number | string | null {
  switch (sort) {
    case "ros":
      return row.blended.ros;
    case "espn":
      return row.espn_proj?.per_game ?? null;
    case "durability":
      return row.durability?.rate ?? null;
    case "age":
      return row.age;
    case "name":
      return row.name ?? "";
    default:
      return row.blended.value;
  }
}

/** Filter, re-blend, sort (nulls last), and page the board server-side. */
export function hockeyBoardRows(
  snapshot: HockeyValuesSnapshot | null | undefined,
  query: HockeyBoardQuery,
): { rows: HockeyBoardRow[]; total: number; pages: number; page: number } {
  const all = Object.values(snapshot?.players ?? {})
    .filter((p) => query.pos === "all" || p.group === query.pos)
    .filter((p) => (query.who === "all" ? true : query.who === "rostered" ? p.rostered : !p.rostered))
    .map((p) => ({ ...p, blended: reblend(p, query.recent) }));
  const sign = query.dir === "asc" ? 1 : -1;
  all.sort((a, b) => {
    const ka = sortKey(a, query.sort);
    const kb = sortKey(b, query.sort);
    if (ka == null && kb == null) return (a.name ?? "").localeCompare(b.name ?? "");
    if (ka == null) return 1;
    if (kb == null) return -1;
    if (typeof ka === "string" || typeof kb === "string") {
      return sign * String(ka).localeCompare(String(kb));
    }
    return sign * (ka - kb) || (a.name ?? "").localeCompare(b.name ?? "");
  });
  const pages = Math.max(1, Math.ceil(all.length / HOCKEY_BOARD_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  const start = (page - 1) * HOCKEY_BOARD_PAGE_SIZE;
  return { rows: all.slice(start, start + HOCKEY_BOARD_PAGE_SIZE), total: all.length, pages, page };
}

/** ESPN id → value / ROS for roster and Waivers columns (default recent form). */
export function hockeyValueIndex(
  snapshot: HockeyValuesSnapshot | null | undefined,
  espnIds: Iterable<number | string | null | undefined>,
): Record<string, { value: number | null; ros: number | null; source: HockeySource }> {
  const players = snapshot?.players;
  if (!players) return {};
  const out: Record<string, { value: number | null; ros: number | null; source: HockeySource }> =
    {};
  for (const id of espnIds) {
    if (id == null) continue;
    const p = players[String(id)];
    if (!p) continue;
    out[String(id)] = { value: p.value, ros: p.ros, source: p.source };
  }
  return out;
}

export function formatValue(v: number | null | undefined, digits = 2): string {
  return v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}

export function formatPercent(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : `${Math.round(v * 100)}%`;
}
