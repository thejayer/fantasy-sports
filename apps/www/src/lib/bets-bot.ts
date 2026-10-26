/**
 * SJ Bot paper-betting board — isolated from human tracker math.
 * Mirrors `sj.bot` artifacts under bets/bot/.
 */

export const BOT_WHO = "SJ Bot";

export type BotSignal = {
  id: string;
  label?: string;
  weight: number;
  value?: number;
  note?: string;
  hits?: number;
  misses?: number;
  alpha?: number;
  beta?: number;
};

export type BotPick = {
  id: string;
  who?: string;
  placed_at?: string | null;
  graded_at?: string | null;
  sport: string;
  market: string;
  side?: string;
  selection: string;
  game_id?: string;
  start?: string | null;
  american?: number | null;
  line?: number | null;
  units: number;
  reason: string;
  signals: BotSignal[];
  result: string;
  units_pl?: number | null;
  clv?: number | null;
  book?: string;
};

export type BotNoteChange = {
  signal: string;
  label?: string;
  from: number;
  to: number;
  delta?: number;
};

export type BotNote = {
  week?: string;
  title?: string;
  body?: string;
  changes?: BotNoteChange[];
  simulated?: boolean;
  markdown?: string;
};

export type BotBankrollPoint = {
  date: string;
  bankroll: number;
};

export type BotBoard = {
  schema_version?: number;
  kind?: string;
  who?: string;
  simulated: boolean;
  simulated_label?: string | null;
  synced_at?: string;
  staking?: string;
  bankroll_start?: number;
  bankroll: number;
  record: string;
  wins?: number;
  losses?: number;
  pushes?: number;
  pending: number;
  units_pl: number;
  bankroll_series: BotBankrollPoint[];
  open: BotPick[];
  recent: BotPick[];
  weights: BotSignal[];
  note: BotNote | null;
  pick_count?: number;
  source?: string;
};

export const EMPTY_BOT_BOARD: BotBoard = {
  simulated: false,
  bankroll: 0,
  record: "0-0-0",
  pending: 0,
  units_pl: 0,
  bankroll_series: [],
  open: [],
  recent: [],
  weights: [],
  note: null,
};

function isPick(value: unknown): value is BotPick {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.selection === "string";
}

function isSignal(value: unknown): value is BotSignal {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.weight === "number";
}

function isPoint(value: unknown): value is BotBankrollPoint {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.date === "string" && typeof row.bankroll === "number";
}

export function parseBotBoard(raw: unknown): BotBoard | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as Partial<BotBoard>;
  const open = Array.isArray(doc.open) ? doc.open.filter(isPick) : [];
  const recent = Array.isArray(doc.recent) ? doc.recent.filter(isPick) : [];
  const weights = Array.isArray(doc.weights) ? doc.weights.filter(isSignal) : [];
  const series = Array.isArray(doc.bankroll_series)
    ? doc.bankroll_series.filter(isPoint)
    : [];
  return {
    ...doc,
    simulated: Boolean(doc.simulated),
    simulated_label: doc.simulated_label ?? (doc.simulated ? "Simulated sample data" : null),
    bankroll: typeof doc.bankroll === "number" ? doc.bankroll : 0,
    record: typeof doc.record === "string" ? doc.record : "0-0-0",
    pending: typeof doc.pending === "number" ? doc.pending : open.length,
    units_pl: typeof doc.units_pl === "number" ? doc.units_pl : 0,
    bankroll_series: series,
    open,
    recent,
    weights,
    note: doc.note && typeof doc.note === "object" ? doc.note : null,
  };
}

export function formatWeight(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

export function formatClv(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)}`;
}

export function drivingSignals(pick: BotPick, limit = 3): BotSignal[] {
  return [...(pick.signals || [])]
    .filter((row) => Math.abs(row.value ?? 0) >= 0.05)
    .sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0))
    .slice(0, limit);
}

export function bankrollMax(series: BotBankrollPoint[]): number {
  const values = series.map((p) => p.bankroll);
  const max = Math.max(0, ...values);
  return max > 0 ? max : 1;
}
