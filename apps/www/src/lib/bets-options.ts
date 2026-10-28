/**
 * Options tracker math — mirrors `sj.bets_options`.
 * Posted P/L only. Blank = not posted. Open rows are not marked to market.
 * P/L % is the evaluated sheet value or nothing — never inferred.
 */

import { asNumber, formatMoney, isBlank, safeHttpUrl } from "@/lib/bets";

export const OPTION_TYPES = ["Call", "Put", "Shares", "Spread", "Daily recap"] as const;
export type OptionType = (typeof OPTION_TYPES)[number];

export const OPTION_STATUSES = ["Open", "Closed", "Expired"] as const;
export type OptionStatus = (typeof OPTION_STATUSES)[number];

export const OPTIONS_FOOTNOTE =
  "Data comes only from posted screenshots and fills.";

export type OptionTrade = {
  id: string;
  trader: string;
  posted?: string | null;
  url?: string | null;
  underlying?: string | null;
  type?: string | null;
  strike?: number | null;
  expiry?: string | null;
  contracts?: number | null;
  entry?: number | null;
  exit?: number | null;
  cost?: number | null;
  proceeds?: number | null;
  pl?: number | null;
  pl_pct?: number | null;
  status?: string | null;
  source?: string | null;
  notes?: string | null;
};

export type OptionTrader = {
  name: string;
  handle?: string | null;
  href?: string | null;
  tracked_since?: string | null;
  notes?: string | null;
  trades: number;
  pl: number;
  pl_posted?: number;
  wins: number;
  losses: number;
  open: number;
  has_daily_recap: boolean;
  green_days?: number | null;
  red_days?: number | null;
};

export type OptionsDocument = {
  schema?: string;
  simulated?: boolean;
  synced_at?: string;
  source?: string;
  trade_count?: number;
  trades: OptionTrade[];
  traders: OptionTrader[];
  footnote?: string;
};

export type OptionPlDisplay = "open" | "not_posted" | "value";

export function isOptionTrade(value: unknown): value is OptionTrade {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.trader === "string";
}

export function isOptionTrader(value: unknown): value is OptionTrader {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.name === "string";
}

export function postedPl(trade: OptionTrade): number | null {
  return asNumber(trade.pl);
}

export function plDisplay(trade: OptionTrade): OptionPlDisplay {
  if ((trade.status || "").trim() === "Open") return "open";
  if (postedPl(trade) == null) return "not_posted";
  return "value";
}

export function formatOptionPl(trade: OptionTrade): string {
  const kind = plDisplay(trade);
  if (kind === "open") return "Open";
  if (kind === "not_posted") return "not posted";
  return formatMoney(postedPl(trade));
}

export function formatOptionPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function uniqueOptionTraders(trades: OptionTrade[]): string[] {
  const counts = new Map<string, number>();
  for (const trade of trades) {
    const name = trade.trader?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

export function uniqueOptionValues(
  trades: OptionTrade[],
  field: "type" | "status",
): string[] {
  const seen = new Set<string>();
  for (const trade of trades) {
    const value = (trade[field] || "").trim();
    if (value) seen.add(value);
  }
  const preferred = field === "type" ? OPTION_TYPES : OPTION_STATUSES;
  const ordered = preferred.filter((item) => seen.has(item));
  const extra = [...seen].filter((item) => !preferred.includes(item as never)).sort();
  return [...ordered, ...extra];
}

export function parseOptionFilter(
  raw: string | null | undefined,
  allowed: string[],
): string {
  const value = (raw || "").trim();
  return value && allowed.includes(value) ? value : "";
}

export function filterOptionTrades(
  trades: OptionTrade[],
  opts: { trader?: string | null; type?: string | null; status?: string | null },
): OptionTrade[] {
  const trader = (opts.trader || "").trim();
  const type = (opts.type || "").trim();
  const status = (opts.status || "").trim();
  return trades.filter((trade) => {
    if (trader && trade.trader !== trader) return false;
    if (type && (trade.type || "") !== type) return false;
    if (status && (trade.status || "") !== status) return false;
    return true;
  });
}

export function optionsHref(opts: {
  who?: string;
  type?: string;
  status?: string;
}): string {
  const params = new URLSearchParams();
  params.set("tab", "options");
  if (opts.who) params.set("who", opts.who);
  if (opts.type) params.set("type", opts.type);
  if (opts.status) params.set("status", opts.status);
  return `/bets?${params.toString()}`;
}

export type CumulativePoint = {
  id: string;
  posted: string;
  pl: number;
  cum: number;
};

export type CumulativeSeries = {
  trader: string;
  points: CumulativePoint[];
};

export function cumulativePlSeries(trades: OptionTrade[]): CumulativeSeries[] {
  const byTrader = new Map<string, OptionTrade[]>();
  for (const trade of trades) {
    if (postedPl(trade) == null) continue;
    const name = trade.trader?.trim();
    if (!name) continue;
    const list = byTrader.get(name) || [];
    list.push(trade);
    byTrader.set(name, list);
  }
  const series: CumulativeSeries[] = [];
  for (const [trader, rows] of byTrader) {
    const ordered = [...rows].sort((a, b) => {
      const ap = a.posted || "";
      const bp = b.posted || "";
      if (ap !== bp) return ap.localeCompare(bp);
      return (a.id || "").localeCompare(b.id || "");
    });
    let cum = 0;
    const points: CumulativePoint[] = ordered.map((trade) => {
      const pl = postedPl(trade) ?? 0;
      cum += pl;
      return { id: trade.id, posted: trade.posted || "", pl, cum };
    });
    series.push({ trader, points });
  }
  return series.sort((a, b) => a.trader.localeCompare(b.trader));
}

export function formatClosedRecord(wins: number, losses: number): string {
  return `${wins}–${losses}`;
}

export function traderHref(trader: OptionTrader): string | null {
  return safeHttpUrl(trader.href || "") ?? null;
}

export function isNotPosted(value: unknown): boolean {
  return isBlank(value) || (typeof value === "string" && value.trim().startsWith("="));
}
