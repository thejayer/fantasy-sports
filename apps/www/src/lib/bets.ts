/**
 * Public-bet tracker math (roadmap P.11).
 * Mirrors `sj.bets` — compute from raw Bets rows only; ignore sheet formula tabs.
 * Bettor cards are data-driven (whoever appears in col B).
 */

export const CFB_START = "2026-08-27";
export const NFL_START = "2026-09-09";

export const BET_WINDOWS = ["all", "cfb", "nfl"] as const;
export type BetWindow = (typeof BET_WINDOWS)[number];

export const WINDOW_LABELS: Record<BetWindow, string> = {
  all: "All",
  cfb: "Since CFB start",
  nfl: "Since NFL start",
};

export const WINDOW_DATES: Record<BetWindow, string | null> = {
  all: null,
  cfb: CFB_START,
  nfl: NFL_START,
};

export const BET_TABS = ["bets", "parlays", "warnings"] as const;
export type BetTab = (typeof BET_TABS)[number];

export const TAB_LABELS: Record<BetTab, string> = {
  bets: "Bets",
  parlays: "Parlay legs",
  warnings: "Public fade",
};

/** Display overlay only — not the list of who appears on the board. */
export const KNOWN_BETTORS: Record<
  string,
  { name: string; handle: string; href: string }
> = {
  Trent: {
    name: "Trent Attyah",
    handle: "BookitWithTrent",
    href: "https://x.com/BookitWithTrent",
  },
  Steve: {
    name: "Steve Will Do It",
    handle: "stevewilldoit",
    href: "https://x.com/stevewilldoit",
  },
  btidy216: {
    name: "btidy216",
    handle: "btidy216",
    href: "https://x.com/btidy216",
  },
  chellgod: {
    name: "chellgod",
    handle: "chellgod",
    href: "https://x.com/chellgod",
  },
};

export function bettorMeta(who: string): { name: string; handle: string; href: string } {
  if (KNOWN_BETTORS[who]) return KNOWN_BETTORS[who];
  const handle = who.replace(/^@/, "") || "unknown";
  return { name: who, handle, href: `https://x.com/${handle}` };
}

export function uniqueBettors(bets: Array<{ who: string }>): string[] {
  const counts = new Map<string, number>();
  for (const bet of bets) {
    const who = bet.who || "Unknown";
    counts.set(who, (counts.get(who) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        a[0].toLowerCase().localeCompare(b[0].toLowerCase()) ||
        a[0].localeCompare(b[0]),
    )
    .map(([who]) => who);
}

export const FADE_AMERICAN = -110;
export const FADE_STAKE = 100;

export type BetRow = {
  id: string;
  who: string;
  posted: string | null;
  gd: string | null;
  kt: string | null;
  prime: string;
  slot: string;
  sport: string;
  lg: string;
  bt: string;
  legs: string;
  n: number | null;
  odds: string | null;
  dec: number | null;
  stake: number | null;
  units: number | null;
  towin: number | null;
  book: string;
  res: string;
  src: string;
  promo: string;
  url: string;
  notes: string;
  ps: string;
};

export type BetsDocument = {
  synced_at?: string;
  source?: string;
  sheet_id?: string;
  tab?: string;
  bet_count?: number;
  bets: BetRow[];
};

export type BettorKpis = {
  who: string | null;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  unknown: number;
  record: string;
  winPct: number | null;
  stake: number | null;
  pl: number | null;
  roi: number | null;
  unitsStaked: number | null;
  unitsPl: number | null;
  unitsRoi: number | null;
};

export type BreakdownRow = BettorKpis & { key: string };

const BLANK = new Set([
  "",
  "-",
  "—",
  "–",
  "n/a",
  "na",
  "none",
  "null",
  "not shown",
  "not matched",
]);

const MULTI_TYPES = new Set(["parlay", "sgp", "prizepicks/dfs"]);

export function parseBetWindow(raw: string | null | undefined): BetWindow {
  const key = (raw || "").trim().toLowerCase();
  if (key === "cfb" || key === "nfl") return key;
  return "all";
}

export function parseBetTab(raw: string | null | undefined): BetTab {
  const key = (raw || "").trim().toLowerCase();
  if (key === "parlays" || key === "parlay" || key === "legs") return "parlays";
  if (key === "warnings" || key === "public" || key === "fade") return "warnings";
  return "bets";
}

export function parseBettor(
  raw: string | null | undefined,
  names: string[],
): string {
  const who = (raw || "").trim();
  if (who && names.includes(who)) return who;
  return "";
}

export function betsHref(opts: {
  tab?: BetTab;
  window?: BetWindow;
  sport?: string;
  who?: string;
}): string {
  const params = new URLSearchParams();
  if (opts.tab && opts.tab !== "bets") params.set("tab", opts.tab);
  if (opts.window && opts.window !== "all") params.set("window", opts.window);
  if (opts.sport) params.set("sport", opts.sport);
  if (opts.who) params.set("who", opts.who);
  const query = params.toString();
  return query ? `/bets?${query}` : "/bets";
}

export function stripValuePrefix(value: unknown): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  const text = String(value).trim();
  if (text.toLowerCase() === "value") return "";
  if (text.toLowerCase().startsWith("value ")) return text.slice(6).trim();
  return text;
}

export function invertResult(value: unknown): string {
  const res = normalizeResult(value);
  if (res === "W") return "L";
  if (res === "L") return "W";
  return res;
}

export function safeHttpUrl(raw: string | null | undefined): string | null {
  const text = (raw || "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    return null;
  }
  return null;
}

export function fadePl(
  result: unknown,
  american = FADE_AMERICAN,
  stake = FADE_STAKE,
): number | null {
  const res = normalizeResult(result);
  if (!isGraded(res)) return null;
  if (res === "Push") return 0;
  if (res === "L") return -stake;
  const dec = americanToDecimal(american);
  if (dec == null) return null;
  return stake * (dec - 1);
}

export function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "number" && !Number.isFinite(value)) return true;
  return BLANK.has(String(value).trim().toLowerCase());
}

export function asNumber(value: unknown): number | null {
  if (isBlank(value)) return null;
  if (typeof value === "boolean") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const text = String(value).trim().replace(/[$,uU]/g, "").replace(/,/g, "");
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

export function normalizeResult(value: unknown): string {
  const key = String(value ?? "")
    .trim()
    .toLowerCase();
  if (key === "w" || key === "win" || key === "won") return "W";
  if (key === "l" || key === "loss" || key === "lost") return "L";
  if (key === "push" || key === "p") return "Push";
  if (key === "pending") return "Pending";
  if (!key || key === "unknown") return "Unknown";
  return String(value).trim() || "Unknown";
}

export function isGraded(result: string): boolean {
  const key = normalizeResult(result).toLowerCase();
  return key === "w" || key === "l" || key === "push";
}

export function americanToDecimal(american: number): number | null {
  if (american === 0) return null;
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}

export function parseOdds(
  raw: unknown,
  decimalHint?: unknown,
): { odds: string | null; dec: number | null } {
  let dec = asNumber(decimalHint);
  if (isBlank(raw)) return { odds: null, dec };
  const text = String(raw).trim();
  const compact = text.replace(/[,\s]/g, "");
  if (/^[+-]/.test(compact) || /^-?\d+(\.\d+)?$/.test(compact)) {
    const num = asNumber(compact);
    if (num == null) return { odds: text, dec };
    if (!/^[+-]/.test(compact) && num > 1 && num < 50 && compact.includes(".")) {
      return { odds: text, dec: dec ?? num };
    }
    if (dec == null && (Math.abs(num) >= 100 || /^[+-]/.test(compact))) {
      dec = americanToDecimal(num);
    }
    return { odds: text, dec };
  }
  return { odds: text, dec };
}

export function windowDate(bet: Pick<BetRow, "gd" | "posted">): {
  date: string | null;
  basis: "game" | "posted" | "none";
} {
  const gd = (bet.gd || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(gd)) {
    return { date: gd.slice(0, 10), basis: "game" };
  }
  const posted = (bet.posted || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(posted)) {
    return { date: posted.slice(0, 10), basis: "posted" };
  }
  return { date: null, basis: "none" };
}

export function inWindow(bet: Pick<BetRow, "gd" | "posted">, window: BetWindow): boolean {
  const start = WINDOW_DATES[window];
  if (!start) return true;
  const { date } = windowDate(bet);
  if (!date) return false;
  return date >= start;
}

export function classifyParlay(bet: Pick<BetRow, "n" | "bt" | "ps">): "single" | "multi" {
  if (bet.n != null && Number.isFinite(bet.n)) {
    return bet.n >= 2 ? "multi" : "single";
  }
  const ps = (bet.ps || "").toLowerCase();
  if (ps.includes("parlay") || ps.includes("multi")) return "multi";
  const bt = (bet.bt || "").trim().toLowerCase();
  if (MULTI_TYPES.has(bt) || bt === "sgp") return "multi";
  return "single";
}

export function dollarPl(bet: Pick<BetRow, "res" | "stake" | "dec" | "odds" | "towin">): number | null {
  const res = normalizeResult(bet.res);
  if (!isGraded(res)) return null;
  const stake = asNumber(bet.stake);
  if (stake == null) return null;
  if (res === "L") return -stake;
  if (res === "Push") return 0;
  let dec = asNumber(bet.dec);
  if (dec == null) dec = parseOdds(bet.odds, bet.dec).dec;
  if (dec != null) return stake * (dec - 1);
  const towin = asNumber(bet.towin);
  if (towin == null) return null;
  return towin > stake ? towin - stake : towin;
}

export function unitsPl(bet: Pick<BetRow, "res" | "units" | "dec" | "odds">): number | null {
  const res = normalizeResult(bet.res);
  if (!isGraded(res)) return null;
  const units = asNumber(bet.units);
  if (units == null) return null;
  if (res === "L") return -units;
  if (res === "Push") return 0;
  let dec = asNumber(bet.dec);
  if (dec == null) dec = parseOdds(bet.odds, bet.dec).dec;
  if (dec == null) return null;
  return units * (dec - 1);
}

function ratio(num: number, den: number): number | null {
  if (den === 0) return null;
  return num / den;
}

export function bettorKpis(bets: BetRow[], who?: string | null): BettorKpis {
  const rows = who ? bets.filter((b) => b.who === who) : bets;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let pending = 0;
  let unknown = 0;
  let stake = 0;
  let pl = 0;
  let stakeN = 0;
  let unitsStaked = 0;
  let unitsProfit = 0;
  let unitsN = 0;
  for (const bet of rows) {
    const res = normalizeResult(bet.res);
    if (res === "W") wins += 1;
    else if (res === "L") losses += 1;
    else if (res === "Push") pushes += 1;
    else if (res === "Pending") pending += 1;
    else unknown += 1;
    const dollar = dollarPl(bet);
    if (dollar != null) {
      stake += asNumber(bet.stake) ?? 0;
      pl += dollar;
      stakeN += 1;
    }
    const uPl = unitsPl(bet);
    const units = asNumber(bet.units);
    if (uPl != null && units != null) {
      unitsStaked += units;
      unitsProfit += uPl;
      unitsN += 1;
    }
  }
  return {
    who: who ?? null,
    bets: rows.length,
    wins,
    losses,
    pushes,
    pending,
    unknown,
    record: `${wins}-${losses}-${pushes}`,
    winPct: ratio(wins, wins + losses),
    stake: stakeN ? stake : null,
    pl: stakeN ? pl : null,
    roi: stakeN ? ratio(pl, stake) : null,
    unitsStaked: unitsN ? unitsStaked : null,
    unitsPl: unitsN ? unitsProfit : null,
    unitsRoi: unitsN ? ratio(unitsProfit, unitsStaked) : null,
  };
}

export function filterBets(
  bets: BetRow[],
  opts: { window?: BetWindow; sport?: string | null; who?: string | null } = {},
): BetRow[] {
  const window = opts.window ?? "all";
  const sport = (opts.sport || "").trim().toLowerCase();
  const who = opts.who || "";
  return bets.filter((bet) => {
    if (who && bet.who !== who) return false;
    if (!inWindow(bet, window)) return false;
    if (sport && (bet.sport || "").trim().toLowerCase() !== sport) return false;
    return true;
  });
}

export function uniqueSports(bets: BetRow[]): string[] {
  return [...new Set(bets.map((b) => b.sport).filter(Boolean))].sort();
}

export function breakdown(
  bets: BetRow[],
  keyFn: (bet: BetRow) => string,
): BreakdownRow[] {
  const groups = new Map<string, BetRow[]>();
  for (const bet of bets) {
    const key = keyFn(bet) || "—";
    const list = groups.get(key) ?? [];
    list.push(bet);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, items]) => ({ key, ...bettorKpis(items), who: null }))
    .sort((a, b) => b.bets - a.bets || a.key.localeCompare(b.key));
}

export function primeBucket(bet: BetRow): string {
  const prime = (bet.prime || "").trim().toUpperCase();
  if (prime === "Y") return "Prime time";
  if (prime === "N") return "Not prime";
  return "Unknown";
}

export function primeSlot(bet: BetRow): string {
  if (primeBucket(bet) !== "Prime time") return "—";
  return (bet.slot || "").trim() || "Unspecified slot";
}

export function gameWeekday(bet: BetRow): string {
  const { date } = windowDate(bet);
  if (!date) return "—";
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()] ?? "—";
}

export function legsBucket(bet: BetRow): string {
  if (bet.n == null) return classifyParlay(bet) === "multi" ? "Multi (n unknown)" : "1";
  return String(bet.n);
}

export function recentBets(bets: BetRow[], limit = 50): BetRow[] {
  return [...bets]
    .sort((a, b) => {
      const ap = a.posted || "";
      const bp = b.posted || "";
      if (ap !== bp) return bp.localeCompare(ap);
      return (b.id || "").localeCompare(a.id || "");
    })
    .slice(0, limit);
}

export function formatMoney(value: number | null, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return value < 0 ? `−${abs}` : abs;
}

export function formatPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatUnits(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)}u`;
}

export function formatSyncedAt(iso: string | undefined): string {
  if (!iso) return "not synced";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function resultTone(result: string): "w" | "l" | "p" | "pending" | "unknown" {
  const res = normalizeResult(result);
  if (res === "W") return "w";
  if (res === "L") return "l";
  if (res === "Push") return "p";
  if (res === "Pending") return "pending";
  return "unknown";
}
