/**
 * Hockey daily tools (HOCKEY-PORT.md H5b): daily start/sit, the goalie start
 * model, the streaming planner, and GP-cap pacing.
 *
 * Pure arithmetic over synced sidecars — `nhl/values.json`, `nhl/schedule.json`,
 * `nhl/team_strength.json`, Daily Faceoff `lines.json` (goalie starts), and the
 * season-points `analysis/slot_points.json` (games used per slot). Nothing
 * here calls ESPN, the NHL, or Daily Faceoff. Client-safe (no fs).
 */

import type { LeagueSnapshot } from "@/lib/data";
import type { SlotPointsSnapshot } from "@/lib/baseball-analysis";
import {
  addDays,
  decisionRow,
  freeAgentRows,
  teamRows,
  type DecisionContext,
  type DecisionRow,
  type Group,
  type HockeyScheduleSnapshot,
} from "@/lib/hockey-decisions";
import type { HockeyLinesSnapshot } from "@/lib/hockey-nhl";

// ---------------------------------------------------------------------------
// inputs
// ---------------------------------------------------------------------------

export type ClubStrength = { gf: number; ga: number; sf: number; sa: number; name?: string };

export type HockeyTeamStrengthSnapshot = {
  league_id: string;
  season: number;
  league_avg: { gf: number; ga: number; sf: number; sa: number };
  teams: Record<string, ClubStrength>;
};

export type DailyContext = DecisionContext & {
  strength: HockeyTeamStrengthSnapshot | null | undefined;
  lines: HockeyLinesSnapshot | null | undefined;
  /** Scoring weights by stat abbreviation (ESPN settings). */
  weights: Record<string, number>;
  /** ESPN lineup slot counts: F / D / G / UTIL. */
  slots: SlotCounts;
  /** ESPN ids sitting in an IR slot (they cannot start). */
  irIds: Set<string>;
};

export type SlotCounts = { F: number; D: number; G: number; UTIL: number };

export const DEFAULT_SLOTS: SlotCounts = { F: 9, D: 5, G: 2, UTIL: 1 };

export function leagueWeights(league: LeagueSnapshot): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of [...(league.settings?.categories ?? []), ...(league.settings?.scoring_format ?? [])]) {
    const abbr = row.abbr?.trim();
    if (abbr && typeof row.points === "number" && !(abbr in out)) out[abbr] = row.points;
  }
  return out;
}

export function leagueSlots(league: LeagueSnapshot): SlotCounts {
  const raw = (league.settings?.position_slot_counts ?? {}) as Record<string, number>;
  const n = (k: keyof SlotCounts) => (typeof raw[k] === "number" ? raw[k]! : DEFAULT_SLOTS[k]);
  return { F: n("F"), D: n("D"), G: n("G"), UTIL: n("UTIL") };
}

export function irIds(league: LeagueSnapshot): Set<string> {
  const out = new Set<string>();
  for (const team of league.teams) {
    for (const p of team.roster ?? []) {
      if (p.slot === "IR" || p.slot === "IL") out.add(String(p.id));
    }
  }
  return out;
}

/** Valid `YYYY-MM-DD`, else null. */
export function parseDate(raw: string | undefined | null): string | null {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

export function windowDates(start: string, days = 7): string[] {
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

type Game = { opp: string; home: boolean; b2b: boolean };

export function gameOn(
  club: string | null | undefined,
  schedule: HockeyScheduleSnapshot | null | undefined,
  date: string,
): Game | null {
  if (!club) return null;
  const g = schedule?.teams?.[club]?.find((x) => x.date === date);
  return g ? { opp: g.opp, home: g.home, b2b: Boolean(g.b2b) } : null;
}

// ---------------------------------------------------------------------------
// 6. goalie start model
// ---------------------------------------------------------------------------

/** Pythagorean exponent for hockey win share from goals for / against. */
export const PYTHAG_EXP = 2;
/** Share of NHL games that reach overtime / shootout (loser takes an OTL). */
export const OT_SHARE = 0.23;
/** Starter start chance on the second night of a back-to-back (no announcement). */
export const B2B_FACTOR = 0.6;

const DFO_START: Record<string, number> = { Confirmed: 1, Likely: 0.8, Unconfirmed: 0.6 };
const DFO_OTHER: Record<string, number> = { Confirmed: 0, Likely: 0.2, Unconfirmed: 0.4 };

export type GoalieGame = {
  win: number;
  loss: number;
  otl: number;
  goalsAgainst: number;
  shotsAgainst: number;
  saves: number;
  shutout: number;
  /** League-scored points if this goalie starts. */
  pointsIfStart: number;
};

/**
 * One goalie start, scored with the league's weights. Expected goals are
 * each club's rate × the opponent's rate ÷ league average; win share is the
 * Pythagorean split of those; shutout chance is Poisson P(0 goals against).
 */
export function goalieGame(
  club: string,
  opp: string,
  strength: HockeyTeamStrengthSnapshot | null | undefined,
  weights: Record<string, number>,
): GoalieGame | null {
  const own = strength?.teams?.[club];
  const vs = strength?.teams?.[opp];
  const lg = strength?.league_avg;
  if (!own || !vs || !lg || !lg.ga || !lg.gf || !lg.sf) return null;
  const xgf = (own.gf * vs.ga) / lg.ga;
  const xga = (vs.gf * own.ga) / lg.gf;
  const shots = (vs.sf * own.sa) / lg.sf;
  const win = xgf ** PYTHAG_EXP / (xgf ** PYTHAG_EXP + xga ** PYTHAG_EXP);
  const loss = (1 - win) * (1 - OT_SHARE);
  const otl = (1 - win) * OT_SHARE;
  const saves = Math.max(0, shots - xga);
  const shutout = Math.exp(-xga);
  const w = (k: string) => weights[k] ?? 0;
  const pointsIfStart =
    w("GS") + w("W") * win + w("L") * loss + w("OTL") * otl + w("GA") * xga +
    w("SA") * shots + w("SV") * saves + w("SO") * shutout;
  return { win, loss, otl, goalsAgainst: xga, shotsAgainst: shots, saves, shutout, pointsIfStart };
}

export type StartOdds = { p: number; basis: string };

/**
 * Chance this goalie starts on `date`: Daily Faceoff when a starter is named
 * (this goalie or a partner), else the goalie's share of starts (H3 durability), with
 * the back-to-back rule applied only when nobody is announced.
 */
export function startOdds(row: DecisionRow, date: string, ctx: DailyContext, b2b: boolean): StartOdds {
  const starts = ctx.lines?.goalie_starts ?? {};
  const mine = row.bio ? starts[String(row.bio.nhlId)]?.[date] : undefined;
  if (mine) return { p: DFO_START[mine.status] ?? 0.6, basis: `${mine.status} (Daily Faceoff)` };
  const club = row.player.nhl_team;
  for (const [nhlId, byDate] of Object.entries(starts)) {
    const other = byDate[date];
    if (!other || nhlId === String(row.bio?.nhlId)) continue;
    const otherClub = Object.values(ctx.bios).find((b) => String(b.nhlId) === nhlId)?.team;
    if (otherClub && otherClub === club) {
      return { p: DFO_OTHER[other.status] ?? 0.4, basis: `Partner ${other.status.toLowerCase()}` };
    }
  }
  const share = row.player.durability?.rate ?? 0.5;
  if (!b2b) return { p: share, basis: "Share of starts" };
  return share >= 0.5
    ? { p: share * B2B_FACTOR, basis: "Back-to-back (starter rests)" }
    : { p: 1 - B2B_FACTOR * (1 - share), basis: "Back-to-back (backup likely)" };
}

// ---------------------------------------------------------------------------
// per-day expected points
// ---------------------------------------------------------------------------

export type DayPlayer = {
  row: DecisionRow;
  game: Game | null;
  expected: number;
  note: string | null;
  goalie?: { odds: StartOdds; model: GoalieGame | null };
};

export function dayPlayer(row: DecisionRow, date: string, ctx: DailyContext): DayPlayer {
  const game = gameOn(row.player.nhl_team, ctx.schedule, date);
  if (!game) return { row, game, expected: 0, note: "No game" };
  if (ctx.irIds.has(row.espnId)) return { row, game, expected: 0, note: "On IR" };
  if (row.injured) return { row, game, expected: 0, note: "Injured" };
  if (row.group === "G") {
    const odds = startOdds(row, date, ctx, game.b2b);
    const model = goalieGame(row.player.nhl_team!, game.opp, ctx.strength, ctx.weights);
    const ifStart = model?.pointsIfStart ?? row.value ?? 0;
    return {
      row,
      game,
      expected: odds.p * ifStart,
      note: odds.p === 0 ? "Partner confirmed" : null,
      goalie: { odds, model },
    };
  }
  const rate = row.player.durability?.rate ?? 1;
  const scratch = row.bio?.possibleScratch ? 0.5 : 1;
  return {
    row,
    game,
    expected: (row.value ?? 0) * rate * scratch,
    note: row.bio?.possibleScratch ? "Possible scratch" : null,
  };
}

// ---------------------------------------------------------------------------
// 5. daily start / sit
// ---------------------------------------------------------------------------

export type SlotName = "F" | "D" | "G" | "UTIL";

export type DailyLineup = {
  date: string;
  starters: Array<{ slot: SlotName; player: DayPlayer | null }>;
  bench: DayPlayer[];
  open: Record<SlotName, number>;
  total: number;
};

const byExpected = (a: DayPlayer, b: DayPlayer) => b.expected - a.expected;

/**
 * Fill F, D, G by expected points, then UTIL with the best skater left.
 * Positions are disjoint and UTIL takes any skater, so this greedy fill is
 * optimal. Players without a game (or at zero) never take a slot.
 */
export function fillLineup(pool: DayPlayer[], slots: SlotCounts, date: string): DailyLineup {
  const playing = pool.filter((p) => p.expected > 0).sort(byExpected);
  const used = new Set<string>();
  const starters: DailyLineup["starters"] = [];
  const open: Record<SlotName, number> = { F: 0, D: 0, G: 0, UTIL: 0 };
  const take = (slot: SlotName, fits: (p: DayPlayer) => boolean, n: number) => {
    const picks = playing.filter((p) => !used.has(p.row.espnId) && fits(p)).slice(0, n);
    for (const p of picks) {
      used.add(p.row.espnId);
      starters.push({ slot, player: p });
    }
    for (let i = picks.length; i < n; i += 1) starters.push({ slot, player: null });
    open[slot] = n - picks.length;
  };
  take("F", (p) => p.row.group === "F", slots.F);
  take("D", (p) => p.row.group === "D", slots.D);
  take("G", (p) => p.row.group === "G", slots.G);
  take("UTIL", (p) => p.row.group !== "G", slots.UTIL);
  const bench = pool.filter((p) => !used.has(p.row.espnId)).sort(byExpected);
  const total = starters.reduce((s, x) => s + (x.player?.expected ?? 0), 0);
  return { date, starters, bench, open, total };
}

export function dailyLineup(ctx: DailyContext, teamId: number | null, date: string): DailyLineup {
  const pool = teamRows(ctx, teamId).map((r) => dayPlayer(r, date, ctx));
  return fillLineup(pool, ctx.slots, date);
}

// ---------------------------------------------------------------------------
// goalie board (tool 6)
// ---------------------------------------------------------------------------

export type GoalieRow = DayPlayer & { owner: number | null };

/** Every goalie with a game on `date`, rostered or free, by expected points. */
export function goalieBoard(ctx: DailyContext, date: string): GoalieRow[] {
  return Object.entries(ctx.values?.players ?? {})
    .filter(([, p]) => p.group === "G")
    .map(([id, p]) => {
      const row = decisionRow(id, p, ctx.bios, ctx.schedule, ctx.start, ctx.prefs?.players[id]);
      return { ...dayPlayer(row, date, ctx), owner: p.rostered ? p.fantasy_team_id : null };
    })
    .filter((r) => r.game != null)
    .sort(byExpected);
}

// ---------------------------------------------------------------------------
// 7. streaming planner
// ---------------------------------------------------------------------------

export type StreamDay = {
  date: string;
  open: Record<SlotName, number>;
  adds: Array<{ player: DayPlayer; slot: SlotName }>;
};

export type StreamPlan = {
  days: StreamDay[];
  /** Free agents by points they'd add over the window (filling open slots). */
  week: Array<{ row: DecisionRow; points: number; days: number }>;
};

function fits(slot: SlotName, g: Group): boolean {
  return slot === "UTIL" ? g !== "G" : slot === g;
}

/**
 * For each day: the team's open slots after its best lineup, and the free
 * agents with a game that would fill them (best first). The weekly list sums
 * each free agent's points on the days they'd fill an open slot.
 */
export function streamingPlan(ctx: DailyContext, teamId: number | null, dates: string[], perDay = 3): StreamPlan {
  const agents = freeAgentRows(ctx);
  const totals = new Map<string, { row: DecisionRow; points: number; days: number }>();
  const days = dates.map((date) => {
    const { open } = dailyLineup(ctx, teamId, date);
    const pool = agents.map((r) => dayPlayer(r, date, ctx)).filter((p) => p.expected > 0).sort(byExpected);
    const adds: StreamDay["adds"] = [];
    const openSlots = (["F", "D", "G", "UTIL"] as const).filter((s) => open[s] > 0);
    for (const p of pool) {
      const slot = openSlots.find((s) => fits(s, p.row.group));
      if (!slot) continue;
      if (adds.length < perDay) adds.push({ player: p, slot });
      const t = totals.get(p.row.espnId) ?? { row: p.row, points: 0, days: 0 };
      t.points += p.expected;
      t.days += 1;
      totals.set(p.row.espnId, t);
    }
    return { date, open, adds };
  });
  const week = [...totals.values()].sort((a, b) => b.points - a.points).slice(0, 10);
  return { days, week };
}

// ---------------------------------------------------------------------------
// 8. GP cap pacing
// ---------------------------------------------------------------------------

/** Analysis slot name → ESPN lineup slot. */
export const ANALYSIS_SLOT: Record<string, SlotName> = {
  Forward: "F",
  Defense: "D",
  Goalie: "G",
  Util: "UTIL",
};

export type PaceRow = {
  slot: SlotName;
  used: number;
  cap: number;
  /** Games a straight-line pace would have used by now. */
  pace: number;
  /** Season total at the current rate. */
  projected: number;
  /** Games per remaining day that would land exactly on the cap. */
  perDayLeft: number | null;
  status: "under" | "on" | "over";
};

export type PaceTable = {
  elapsedDays: number;
  seasonDays: number;
  rows: PaceRow[];
};

export function gpCaps(league: LeagueSnapshot): Partial<Record<SlotName, number>> {
  const out: Partial<Record<SlotName, number>> = {};
  for (const row of (league.settings?.lineup_slot_stat_limits ?? []) as Array<{
    slot?: string;
    stat?: string;
    limit?: number;
  }>) {
    if (row.stat === "GP" && typeof row.limit === "number" && row.slot) {
      out[row.slot as SlotName] = row.limit;
    }
  }
  return out;
}

/** Regular-season length in days, from the NHL schedule's first to last game. */
export function seasonDays(schedule: HockeyScheduleSnapshot | null | undefined): number | null {
  const dates = Object.values(schedule?.teams ?? {})
    .flat()
    .map((g) => g.date)
    .sort();
  if (!dates.length) return null;
  const first = Date.parse(`${dates[0]}T00:00:00Z`);
  const last = Date.parse(`${dates[dates.length - 1]}T00:00:00Z`);
  return Math.round((last - first) / 86_400_000) + 1;
}

/** Within ±3% of pace counts as on pace. */
const PACE_BAND = 0.03;

export function paceTable(
  slotPoints: SlotPointsSnapshot | null | undefined,
  league: LeagueSnapshot,
  schedule: HockeyScheduleSnapshot | null | undefined,
  teamId: number | null,
): PaceTable | null {
  const team = slotPoints?.teams.find((t) => t.team_id === teamId);
  const elapsed = slotPoints?.periods?.latest ?? null;
  // ESPN's final scoring period is the season in days; the NHL schedule's
  // span is the fallback, only when it actually covers the days counted.
  const span = seasonDays(schedule);
  const total = slotPoints?.periods?.final ?? (span != null && elapsed != null && span >= elapsed ? span : null);
  if (!team?.games || !elapsed || !total) return null;
  const caps = gpCaps(league);
  const frac = Math.min(1, elapsed / total);
  const rows: PaceRow[] = [];
  for (const [name, slot] of Object.entries(ANALYSIS_SLOT)) {
    const cap = caps[slot];
    const used = team.games[name];
    if (cap == null || used == null) continue;
    const pace = cap * frac;
    const projected = frac > 0 ? used / frac : used;
    const left = total - elapsed;
    const ratio = projected / cap;
    rows.push({
      slot,
      used,
      cap,
      pace,
      projected,
      perDayLeft: left > 0 ? Math.max(0, cap - used) / left : null,
      status: ratio > 1 + PACE_BAND ? "over" : ratio < 1 - PACE_BAND ? "under" : "on",
    });
  }
  return rows.length ? { elapsedDays: elapsed, seasonDays: total, rows } : null;
}

export const SLOT_LABEL: Record<SlotName, string> = { F: "Forwards", D: "Defense", G: "Goalies", UTIL: "Utility" };
