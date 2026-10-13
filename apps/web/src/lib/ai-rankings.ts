/**
 * Weekly AI rankings (roadmap 7.16).
 *
 * Snapshots are produced offline by `sj ai-rankings` and stored under
 * `ai_rankings/cfb/{season}-wNN.json` and
 * `ai_rankings/fantasy/{league_id}/{season}-wNN.json`. Offseason and
 * preseason fantasy boards use `{season}-off-YYYYMMDD`.
 */

export const AI_RANKINGS_FANTASY_LEAGUES = [
  "baseball-dynasty",
  "football-main",
  "football-dynasty",
  "hockey-main",
] as const;

export type AiRankingsBoard = "cfb" | "fantasy";

export type AiRankingRow = {
  rank: number;
  prev_rank?: number | null;
  delta?: number | null;
  team_id?: string | number | null;
  name: string;
  conference?: string | null;
  record?: string | null;
  blurb?: string | null;
  ap_rank?: number | null;
  vs_ap?: number | null;
  abbrev?: string | null;
  owners?: string[];
  points_for?: number | null;
  points_against?: number | null;
  standing?: number | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
};

export type AiRankingsMovers = {
  risers?: AiRankingRow[];
  fallers?: AiRankingRow[];
  new?: AiRankingRow[];
  dropped?: Array<{ name?: string | null; prev_rank?: number | null }>;
};

export type AiRankingsSnapshot = {
  schema_version: number;
  board: AiRankingsBoard | string;
  season: number;
  week: number;
  week_label: string;
  league_id?: string | null;
  name?: string | null;
  sport?: string | null;
  format?: string | null;
  phase?: string | null;
  generated_at?: string;
  model?: string | null;
  temperature?: number | null;
  facts_hash?: string | null;
  headline?: string | null;
  methodology?: string | null;
  last_week_review?: string | null;
  notes?: string[];
  degraded?: string[];
  rankings: AiRankingRow[];
  full_rankings?: AiRankingRow[];
  movers?: AiRankingsMovers;
  ap_available?: boolean;
};

export type AiRankingsIndex = {
  board: AiRankingsBoard | string;
  league_id?: string | null;
  latest?: string | null;
  weeks: string[];
  updated_at?: string;
};

export const FANTASY_LEAGUE_LABELS: Record<string, string> = {
  "baseball-dynasty": "Baseball Dynasty",
  "football-main": "Football Main",
  "football-dynasty": "Football Dynasty",
  "hockey-main": "Hockey Main",
};

function isAiRankingRow(value: unknown): value is AiRankingRow {
  if (!value || typeof value !== "object") return false;
  const row = value as AiRankingRow;
  return typeof row.name === "string" && typeof row.rank === "number";
}

export function isAiRankingsSnapshot(value: unknown): value is AiRankingsSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as AiRankingsSnapshot;
  return (
    typeof row.week_label === "string" &&
    typeof row.season === "number" &&
    Array.isArray(row.rankings) &&
    row.rankings.every(isAiRankingRow)
  );
}

export function isAiRankingsIndex(value: unknown): value is AiRankingsIndex {
  if (!value || typeof value !== "object") return false;
  const row = value as AiRankingsIndex;
  return Array.isArray(row.weeks) && row.weeks.every((week) => typeof week === "string");
}

export function deltaLabel(delta: number | null | undefined): string {
  if (delta == null || Number.isNaN(delta)) return "—";
  if (delta === 0) return "—";
  return delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`;
}

export function vsApLabel(vsAp: number | null | undefined): string {
  if (vsAp == null || Number.isNaN(vsAp)) return "—";
  if (vsAp === 0) return "even";
  return vsAp < 0 ? `${vsAp} vs AP` : `+${vsAp} vs AP`;
}

export function modelLabel(model: string | null | undefined): string {
  const raw = (model ?? "").trim();
  if (!raw || raw === "none") return "No model";
  if (raw === "fixture") return "Fixture ballot";
  return raw;
}

export function resolveWeekLabel(
  index: AiRankingsIndex | null,
  requested?: string | null,
): string | null {
  const weeks = index?.weeks ?? [];
  const want = requested?.trim();
  if (want && weeks.includes(want)) return want;
  if (index?.latest && weeks.includes(index.latest)) return index.latest;
  return weeks.length ? weeks[weeks.length - 1] : null;
}

export function formatWeekChip(label: string): string {
  const offDay = label.match(/^(\d+)-off-(\d{8})$/i);
  if (offDay) {
    const stamp = offDay[2];
    const month = Number(stamp.slice(4, 6));
    const day = Number(stamp.slice(6, 8));
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const mon = months[month - 1] ?? stamp.slice(4, 6);
    return `${offDay[1]} · ${mon} ${day}`;
  }
  const off = label.match(/^(\d+)-off$/i);
  if (off) return `${off[1]} offseason`;
  const week = label.match(/^(\d+)-w(\d+)$/i);
  if (week) return `${week[1]} · W${Number(week[2])}`;
  return label;
}
