/**
 * Season-points baseball analysis helpers (roadmap 8.5).
 *
 * Snapshot arithmetic over ``analysis/slot_points.json`` +
 * ``analysis/points_timeseries.json``. Projection-free.
 */

export const SLOT_COLUMNS = [
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "OF",
  "DH",
  "UTIL",
  "P",
  "RP",
] as const;

export type SlotColumn = (typeof SLOT_COLUMNS)[number];

export const BAT_SLOTS = [
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "OF",
  "DH",
  "UTIL",
] as const;

export const PITCH_SLOTS = ["P", "RP"] as const;

export type AnalysisSeriesMode = "cumulative" | "daily" | "weekly";

export type SlotPointsTeam = {
  team_id: number;
  name: string;
  slots: Partial<Record<string, number>>;
  starters: number;
  bats?: number;
  pitchers?: number;
  bench_il: number;
  espn_points: number | null;
  delta: number | null;
};

export type SlotPointsSnapshot = {
  schema_version: number;
  league_id: string;
  espn_league_id?: number | null;
  season: number;
  sport: string;
  scoring_type?: string | null;
  method?: string;
  synced_at?: string;
  incremental?: boolean;
  periods?: {
    first?: number | null;
    latest?: number | null;
    ok?: number;
    failed?: number[];
  };
  slots?: string[];
  teams: SlotPointsTeam[];
};

export type TimeseriesPoint = {
  period: number;
  date?: string | null;
  daily_starters: number;
  cumulative_starters: number;
  daily_bats?: number;
  daily_pitchers?: number;
  espn_daily?: number;
};

export type TimeseriesTeam = {
  team_id: number;
  name: string;
  points: TimeseriesPoint[];
};

export type PointsTimeseriesSnapshot = {
  schema_version: number;
  league_id: string;
  season: number;
  sport: string;
  scoring_type?: string | null;
  method?: string;
  synced_at?: string;
  grain?: string;
  period_label?: string;
  teams: TimeseriesTeam[];
};

export type BaseballAnalysisSnapshot = {
  slotPoints: SlotPointsSnapshot | null;
  timeseries: PointsTimeseriesSnapshot | null;
};

export type SlotTableRow = SlotPointsTeam & {
  bats: number;
  pitchers: number;
};

export type ChartLine = {
  teamId: number;
  name: string;
  color: string;
  points: Array<{ x: number; y: number; label: string }>;
};

export type ChartModel = {
  lines: ChartLine[];
  xTicks: Array<{ x: number; label: string }>;
  yMax: number;
  yTicks: number[];
};

const TEAM_COLORS = [
  "#ec3013",
  "#1d4e89",
  "#2f6f4e",
  "#8a5a00",
  "#6b3fa0",
  "#0b6e6e",
  "#9a3412",
  "#334155",
];

export function parseAnalysisSeriesMode(
  raw: string | undefined,
): AnalysisSeriesMode {
  if (raw === "daily" || raw === "weekly") return raw;
  return "cumulative";
}

export function slotValue(row: SlotPointsTeam, slot: string): number {
  return Number(row.slots?.[slot] ?? 0);
}

export function deriveBats(row: SlotPointsTeam): number {
  if (row.bats != null && Number.isFinite(row.bats)) return row.bats;
  return BAT_SLOTS.reduce((sum, slot) => sum + slotValue(row, slot), 0);
}

export function derivePitchers(row: SlotPointsTeam): number {
  if (row.pitchers != null && Number.isFinite(row.pitchers)) return row.pitchers;
  return PITCH_SLOTS.reduce((sum, slot) => sum + slotValue(row, slot), 0);
}

export function slotTableRows(snapshot: SlotPointsSnapshot | null): SlotTableRow[] {
  if (!snapshot?.teams?.length) return [];
  return snapshot.teams.map((team) => ({
    ...team,
    bats: deriveBats(team),
    pitchers: derivePitchers(team),
  }));
}

export function fpLabel(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

export function isoWeekKey(isoDate: string | null | undefined, period: number): string {
  if (!isoDate || isoDate.length < 10) {
    return `p${Math.floor((period - 1) / 7)}`;
  }
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return `p${Math.floor((period - 1) / 7)}`;
  }
  // ISO week: Thursday-based year + week number.
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const thursday = new Date(day);
  thursday.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function rollupWeekly(points: TimeseriesPoint[]): TimeseriesPoint[] {
  const buckets = new Map<string, TimeseriesPoint>();
  const order: string[] = [];
  for (const point of points) {
    const key = isoWeekKey(point.date, point.period);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        period: point.period,
        date: point.date,
        daily_starters: point.daily_starters,
        cumulative_starters: point.cumulative_starters,
        daily_bats: point.daily_bats ?? 0,
        daily_pitchers: point.daily_pitchers ?? 0,
      });
      order.push(key);
      continue;
    }
    existing.daily_starters += point.daily_starters;
    existing.cumulative_starters = point.cumulative_starters;
    existing.daily_bats = (existing.daily_bats ?? 0) + (point.daily_bats ?? 0);
    existing.daily_pitchers =
      (existing.daily_pitchers ?? 0) + (point.daily_pitchers ?? 0);
    existing.date = point.date ?? existing.date;
    existing.period = point.period;
  }
  return order.map((key) => {
    const row = buckets.get(key)!;
    return {
      ...row,
      daily_starters: Math.round(row.daily_starters * 10) / 10,
      daily_bats:
        row.daily_bats != null ? Math.round(row.daily_bats * 10) / 10 : undefined,
      daily_pitchers:
        row.daily_pitchers != null
          ? Math.round(row.daily_pitchers * 10) / 10
          : undefined,
    };
  });
}

export function seriesValues(
  points: TimeseriesPoint[],
  mode: AnalysisSeriesMode,
): TimeseriesPoint[] {
  if (mode === "weekly") return rollupWeekly(points);
  return points;
}

export function yForPoint(point: TimeseriesPoint, mode: AnalysisSeriesMode): number {
  if (mode === "cumulative") return point.cumulative_starters;
  return point.daily_starters;
}

function monthTickLabel(isoDate: string | null | undefined, period: number): string {
  if (isoDate && isoDate.length >= 7) {
    const [year, month] = isoDate.split("-");
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
    const idx = Number(month) - 1;
    if (idx >= 0 && idx < 12) {
      return `${months[idx]} ${year}`;
    }
  }
  return `P${period}`;
}

export function buildChartModel(
  snapshot: PointsTimeseriesSnapshot | null,
  mode: AnalysisSeriesMode,
): ChartModel | null {
  if (!snapshot?.teams?.length) return null;
  const lines: ChartLine[] = snapshot.teams.map((team, index) => {
    const values = seriesValues(team.points ?? [], mode);
    return {
      teamId: team.team_id,
      name: team.name,
      color: TEAM_COLORS[index % TEAM_COLORS.length],
      points: values.map((point, i) => ({
        x: values.length <= 1 ? 0 : i / (values.length - 1),
        y: yForPoint(point, mode),
        label: point.date || `P${point.period}`,
      })),
    };
  });
  const yMaxRaw = Math.max(
    0,
    ...lines.flatMap((line) => line.points.map((p) => p.y)),
  );
  const yMax = yMaxRaw <= 0 ? 1 : Math.ceil(yMaxRaw / 4) * 4;
  const yTicks = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax];

  const first = snapshot.teams[0]?.points ?? [];
  const rolled = seriesValues(first, mode);
  const xTicks: Array<{ x: number; label: string }> = [];
  const seen = new Set<string>();
  rolled.forEach((point, i) => {
    const x = rolled.length <= 1 ? 0 : i / (rolled.length - 1);
    const label = monthTickLabel(point.date, point.period);
    if (mode === "weekly") {
      xTicks.push({ x, label: point.date ? monthTickLabel(point.date, point.period) : `W${i + 1}` });
      return;
    }
    if (!seen.has(label) || i === 0 || i === rolled.length - 1) {
      if (!seen.has(label) || i === rolled.length - 1) {
        seen.add(label);
        xTicks.push({ x, label });
      }
    }
  });
  // Keep the axis readable — at most ~6 ticks.
  if (xTicks.length > 6) {
    const keep = [xTicks[0]];
    const step = (xTicks.length - 1) / 4;
    for (let i = 1; i < 4; i += 1) {
      keep.push(xTicks[Math.round(i * step)]);
    }
    keep.push(xTicks[xTicks.length - 1]);
    return { lines, xTicks: keep, yMax, yTicks };
  }
  return { lines, xTicks, yMax, yTicks };
}

export function linePath(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
  yMax: number,
): string {
  if (!points.length) return "";
  return points
    .map((point, index) => {
      const x = point.x * width;
      const y = height - (yMax <= 0 ? 0 : (point.y / yMax) * height);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
