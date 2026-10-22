/**
 * Tailing parlay-leg math — mirrors `sj.bets_tailing`.
 * Flat 1u tail / fade at −110; ticket-implied breakeven is an estimate.
 */

import { americanToDecimal, FADE_AMERICAN, uniqueBettors } from "@/lib/bets";

export const ALL_WHO = "*";
export const SMALL_SAMPLE = 20;
export const SPORTSBOOK_PLATFORM = "Sportsbook parlay";
export const TAIL_SIZE_ORDER = ["2-3 legs", "4-5 legs", "6+ legs"] as const;
export const TAIL_MONTH_ORDER = [
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
] as const;

export type TailSignal = "tail" | "avoid" | "marginal" | "small_sample";

export type TailLeg = {
  id: string;
  who: string;
  parent: string;
  gd: string | null;
  sport: string;
  pick: string;
  leg_type: string;
  stat: string;
  ou: string;
  sel: string;
  res: string;
  platform: string;
  ticket_n: number | null;
  ticket_size: string;
  month: string;
  odds_american: number | null;
  ticket_implied_dec: number | null;
  team_type: string;
};

export type TailBucket = {
  key?: string;
  wins: number;
  losses: number;
  pushes: number;
  n: number;
  record: string;
  hit: number | null;
  tail_110: number;
  fade_110: number;
  small_sample: boolean;
  signal: TailSignal;
  known_odds: number;
  pl_known: number | null;
  be_known: number | null;
  ticket_implied_n: number;
  ticket_implied_wins: number;
  ticket_implied_pl: number | null;
  ticket_implied_be: number | null;
  ticket_implied_tail_110: number | null;
};

export type TailView = {
  who: string;
  hypothetical_1u: boolean;
  overall: TailBucket;
  ml: TailBucket | null;
  splits: {
    sport: TailBucket[];
    pick_group: TailBucket[];
    direction: TailBucket[];
    stat: TailBucket[];
    platform: TailBucket[];
    ticket_size: TailBucket[];
    month: TailBucket[];
    leg_type: TailBucket[];
  };
};

export type TailingDocument = {
  synced_at?: string;
  source?: string;
  sheet_id?: string;
  tab?: string;
  joined_tab?: string;
  leg_count?: number;
  settled_count?: number;
  small_sample?: number;
  assumed_odds?: number;
  breakeven?: number;
  odds_note?: string;
  views: TailView[];
  bettors?: string[];
  legs: TailLeg[];
};

export type TailFilters = {
  who?: string | null;
  sport?: string | null;
  pick?: string | null;
  plat?: string | null;
  size?: string | null;
  month?: string | null;
  ou?: string | null;
};

function ratio(num: number, den: number): number | null {
  if (den === 0) return null;
  return num / den;
}

function assumedDecimal(): number {
  return americanToDecimal(FADE_AMERICAN) ?? 1 + 100 / 110;
}

function unitsAt(dec: number, wins: number, losses: number): number {
  return wins * (dec - 1) - losses;
}

export function tailBucket(rows: TailLeg[]): TailBucket {
  const dec = assumedDecimal();
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let known = 0;
  let plKnown = 0;
  let beSum = 0;
  let tiN = 0;
  let tiWins = 0;
  let tiPl = 0;
  let tiBe = 0;
  for (const row of rows) {
    const res = row.res;
    if (res === "W") wins += 1;
    else if (res === "L") losses += 1;
    else if (res === "Push") pushes += 1;
    else continue;
    if ((res === "W" || res === "L") && row.odds_american != null) {
      const priced = americanToDecimal(row.odds_american);
      if (priced != null) {
        known += 1;
        beSum += 1 / priced;
        plKnown += res === "W" ? priced - 1 : -1;
      }
    }
    const implied = row.ticket_implied_dec;
    if ((res === "W" || res === "L") && implied != null && implied > 1) {
      tiN += 1;
      tiBe += 1 / implied;
      tiPl += res === "W" ? implied - 1 : -1;
      if (res === "W") tiWins += 1;
    }
  }
  const decided = wins + losses;
  const hit = ratio(wins, decided);
  const be = 1 / dec;
  const small = decided < SMALL_SAMPLE;
  let signal: TailSignal = "small_sample";
  if (!small && hit != null) {
    if (hit >= be + 0.03) signal = "tail";
    else if (hit < be) signal = "avoid";
    else signal = "marginal";
  }
  return {
    wins,
    losses,
    pushes,
    n: decided,
    record: `${wins}-${losses}-${pushes}`,
    hit,
    tail_110: unitsAt(dec, wins, losses),
    fade_110: unitsAt(dec, losses, wins),
    small_sample: small,
    signal,
    known_odds: known,
    pl_known: known ? plKnown : null,
    be_known: known ? beSum / known : null,
    ticket_implied_n: tiN,
    ticket_implied_wins: tiWins,
    ticket_implied_pl: tiN ? tiPl : null,
    ticket_implied_be: tiN ? tiBe / tiN : null,
    ticket_implied_tail_110: tiN ? unitsAt(dec, tiWins, tiN - tiWins) : null,
  };
}

export function filterTailLegs(legs: TailLeg[], opts: TailFilters = {}): TailLeg[] {
  const who = opts.who && opts.who !== ALL_WHO ? opts.who : "";
  const sport = (opts.sport || "").trim().toLowerCase();
  const pick = (opts.pick || "").trim().toLowerCase();
  const plat = (opts.plat || "").trim().toLowerCase();
  const size = (opts.size || "").trim().toLowerCase();
  const month = (opts.month || "").trim().toLowerCase();
  const ou = (opts.ou || "").trim().toLowerCase();
  return legs.filter((leg) => {
    if (who && leg.who !== who) return false;
    if (sport && (leg.sport || "").trim().toLowerCase() !== sport) return false;
    if (pick && (leg.pick || "").trim().toLowerCase() !== pick) return false;
    if (plat && (leg.platform || "").trim().toLowerCase() !== plat) return false;
    if (size && (leg.ticket_size || "").trim().toLowerCase() !== size) return false;
    if (month && (leg.month || "").trim().toLowerCase() !== month) return false;
    if (ou && (leg.ou || "").trim().toLowerCase() !== ou) return false;
    return true;
  });
}

function groupBuckets(
  rows: TailLeg[],
  keyFn: (leg: TailLeg) => string,
  order?: readonly string[],
): TailBucket[] {
  const groups = new Map<string, TailLeg[]>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const keys = order
    ? [...order.filter((key) => groups.has(key)), ...[...groups.keys()].filter((key) => !order.includes(key))]
    : [...groups.keys()].sort((a, b) => (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0) || a.localeCompare(b));
  return keys.map((key) => ({ key, ...tailBucket(groups.get(key) ?? []) }));
}

export function tailSplits(rows: TailLeg[]): TailView["splits"] {
  const props = rows.filter((row) => row.pick === "Player prop");
  const teams = rows.filter((row) => row.pick === "Team pick");
  return {
    sport: groupBuckets(rows, (row) => row.sport || "Other"),
    pick_group: groupBuckets(rows, (row) => row.pick || "—", ["Team pick", "Player prop"]),
    direction: groupBuckets(props, (row) => row.ou || "Other", ["Over", "Under"]),
    stat: groupBuckets(props, (row) => row.stat || "—"),
    platform: groupBuckets(rows, (row) => row.platform || "Other"),
    ticket_size: groupBuckets(rows, (row) => row.ticket_size || "Unknown", TAIL_SIZE_ORDER),
    month: groupBuckets(rows, (row) => row.month || "Unknown", TAIL_MONTH_ORDER),
    leg_type: groupBuckets(teams, (row) => row.team_type || "Other"),
  };
}

export function uniqueTailValues(legs: TailLeg[], field: keyof TailLeg): string[] {
  const values = new Set<string>();
  for (const leg of legs) {
    const raw = leg[field];
    if (typeof raw === "string" && raw) values.add(raw);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function uniqueTailBettors(legs: TailLeg[]): string[] {
  return uniqueBettors(legs);
}

export function isSportsbookPlatform(platform: string | null | undefined): boolean {
  return (platform || "").trim().toLowerCase() === SPORTSBOOK_PLATFORM.toLowerCase();
}

export function pricedSportsbookLegs(legs: TailLeg[]): TailLeg[] {
  return legs.filter(
    (leg) =>
      isSportsbookPlatform(leg.platform) &&
      leg.ticket_implied_dec != null &&
      leg.ticket_implied_dec > 1,
  );
}

export function signalLabel(signal: TailSignal): string {
  if (signal === "small_sample") return "Small sample";
  if (signal === "tail") return "Tail";
  if (signal === "avoid") return "Avoid";
  return "Marginal";
}
