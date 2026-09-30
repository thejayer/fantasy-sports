/**
 * Hockey decision tools (HOCKEY-PORT.md H5a): waiver board, compare free
 * agents, evaluate a move, weakest-to-best.
 *
 * Pure arithmetic over synced sidecars — `nhl/values.json` (value, ROS,
 * durability), `nhl/schedule.json` (upcoming games), and the NHL bios/lines
 * join from `lib/hockey-nhl.ts`. Nothing here calls ESPN, the NHL, or Daily
 * Faceoff. Client-safe (no fs).
 *
 * Open to every member (Austin's call): any team can be picked; a linked
 * member's own team is the default.
 */

import type { HockeyBio, HockeyBioIndex } from "@/lib/hockey-nhl";
import type { HockeyPlayerValue, HockeyValuesSnapshot } from "@/lib/hockey-values";
import { isKept, isWatched, type MemberPrefs, type PlayerPref } from "@/lib/member-prefs";

export type HockeyScheduleSnapshot = {
  league_id: string;
  season: number;
  sport: "hockey";
  teams: Record<string, { date: string; opp: string; home: boolean; b2b?: boolean }[]>;
};

export type Group = "F" | "D" | "G";

/** SJ Hockey roster rule (Rinkside MAX_GOALIES): at most four goalies. */
export const MAX_GOALIES = 4;
/** ESPN injury words that make an add "injured". */
const UNAVAILABLE = new Set(["OUT", "INJURY_RESERVE", "IR", "SUSPENSION", "DAY_TO_DAY"]);
export const TALL_INCHES = 75; // 6'3"
/**
 * H7 drop protection: rostered in this share of ESPN leagues or more (the
 * average of available sources; ESPN is the only one synced). Rinkside default.
 */
export const PROTECT_OWNED = 85;
/** A free agent gaining this much % rostered over 7 days is "rising". */
export const RISING_CHANGE = 1;

// ---------------------------------------------------------------------------
// clock + schedule
// ---------------------------------------------------------------------------

/**
 * First day of the "upcoming games" window. Live: today (UTC), never before
 * the sync date. Committed fixtures are synced in July for an October slate,
 * so a fixture snapshot starts at its first scheduled game (deterministic
 * offline — same idea as golf's `lineupClock`).
 */
export function windowStart(
  values: Pick<HockeyValuesSnapshot, "as_of" | "generated_at"> | null | undefined,
  schedule: HockeyScheduleSnapshot | null | undefined,
  now: Date = new Date(),
): string {
  const today = now.toISOString().slice(0, 10);
  const asOf = values?.as_of ?? today;
  const first = Object.values(schedule?.teams ?? {})
    .flat()
    .map((g) => g.date)
    .sort()[0];
  // Committed fixtures are stamped FIXED_TIMESTAMP (sj.fixtures); pin them to
  // their slate so offline views never depend on the wall clock.
  const fixture = values?.generated_at?.startsWith(FIXTURE_STAMP) ?? false;
  if (first && asOf < first && (today < first || fixture)) return first; // preseason / fixtures
  return asOf > today ? asOf : today;
}

/** ``sj.fixtures.FIXED_TIMESTAMP`` date. */
export const FIXTURE_STAMP = "2026-07-27";

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Club games in [start, start + days). */
export function gamesInWindow(
  team: string | null | undefined,
  schedule: HockeyScheduleSnapshot | null | undefined,
  start: string,
  days: number,
): number | null {
  if (!team || !schedule?.teams) return null;
  const games = schedule.teams[team];
  if (!games) return null;
  const end = addDays(start, days);
  return games.filter((g) => g.date >= start && g.date < end).length;
}

/** Expected points over the window: value × games × share played. */
export function windowPoints(
  player: HockeyPlayerValue,
  schedule: HockeyScheduleSnapshot | null | undefined,
  start: string,
  days: number,
): number | null {
  const games = gamesInWindow(player.nhl_team, schedule, start, days);
  if (games == null || player.value == null) return null;
  return player.value * games * (player.durability?.rate ?? 1);
}

// ---------------------------------------------------------------------------
// rows
// ---------------------------------------------------------------------------

export type DecisionRow = {
  espnId: string;
  player: HockeyPlayerValue;
  bio: HockeyBio | undefined;
  group: Group;
  value: number | null;
  ros: number | null;
  next7: number | null;
  next14: number | null;
  games7: number | null;
  injured: boolean;
  /** ESPN-wide % rostered and its 7-day change (H7). */
  owned: number | null;
  ownedChange: number | null;
  /** Widely rostered (≥ PROTECT_OWNED) or tagged Keep: never suggested as a drop. */
  protected: boolean;
  /** H8: the viewer's own tags / note for this player. */
  tags: string[];
  note: string;
  kept: boolean;
  watched: boolean;
};

export function isInjured(player: HockeyPlayerValue, bio?: HockeyBio): boolean {
  const espn = String(player.injury_status ?? "").toUpperCase();
  const dfo = String(bio?.injury ?? "").toLowerCase();
  return UNAVAILABLE.has(espn) || ["out", "ir", "ltir", "suspended", "dtd"].includes(dfo);
}

export function decisionRow(
  espnId: string,
  player: HockeyPlayerValue,
  bios: HockeyBioIndex,
  schedule: HockeyScheduleSnapshot | null | undefined,
  start: string,
  pref?: PlayerPref,
): DecisionRow {
  const bio = bios[espnId];
  const kept = isKept(pref);
  return {
    espnId,
    player,
    bio,
    group: player.group,
    value: player.value,
    ros: player.ros,
    next7: windowPoints(player, schedule, start, 7),
    next14: windowPoints(player, schedule, start, 14),
    games7: gamesInWindow(player.nhl_team, schedule, start, 7),
    injured: isInjured(player, bio),
    owned: player.percent_owned ?? null,
    ownedChange: player.percent_change ?? null,
    protected: kept || (player.percent_owned ?? 0) >= PROTECT_OWNED,
    tags: pref?.tags ?? [],
    note: pref?.note ?? "",
    kept,
    watched: isWatched(pref),
  };
}

export type DecisionContext = {
  values: HockeyValuesSnapshot | null | undefined;
  bios: HockeyBioIndex;
  schedule: HockeyScheduleSnapshot | null | undefined;
  start: string;
  /** H8: the viewer's tags (bios should already carry their role tags). */
  prefs?: MemberPrefs | null;
};

function allRows(ctx: DecisionContext): DecisionRow[] {
  return Object.entries(ctx.values?.players ?? {}).map(([id, p]) =>
    decisionRow(id, p, ctx.bios, ctx.schedule, ctx.start, ctx.prefs?.players[id]),
  );
}

export function teamRows(ctx: DecisionContext, teamId: number | null | undefined): DecisionRow[] {
  if (teamId == null) return [];
  return allRows(ctx).filter((r) => r.player.rostered && r.player.fantasy_team_id === teamId);
}

export function freeAgentRows(ctx: DecisionContext): DecisionRow[] {
  return allRows(ctx).filter((r) => !r.player.rostered);
}

/**
 * The weakest player per group on a roster: lowest value among players who
 * count. Skips injured players (IR candidates, not drop candidates) and
 * protected ones (≥ PROTECT_OWNED% rostered on ESPN — H7). Member "Keep"
 * tags arrive with H8.
 */
export function weakestByGroup(rows: DecisionRow[]): Partial<Record<Group, DecisionRow>> {
  const out: Partial<Record<Group, DecisionRow>> = {};
  for (const row of rows) {
    if (row.value == null || row.injured || row.protected) continue;
    const cur = out[row.group];
    if (!cur || (cur.value ?? Infinity) > row.value) out[row.group] = row;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. waiver board
// ---------------------------------------------------------------------------

export type WaiverFilters = {
  pos: "all" | Group;
  healthy: boolean;
  pp: boolean;
  rookies: boolean;
  tall: boolean;
  iron: boolean;
  /** H7: gaining ≥ RISING_CHANGE % rostered over 7 days. */
  rising: boolean;
  /** H8: only players on the viewer's watchlist. */
  watch: boolean;
};

export const NO_FILTERS: WaiverFilters = {
  pos: "all",
  healthy: false,
  pp: false,
  rookies: false,
  tall: false,
  iron: false,
  rising: false,
  watch: false,
};

export type WaiverRow = DecisionRow & {
  upgrade: number | null;
  replaces: DecisionRow | null;
};

export function parseWaiverFilters(raw: Record<string, string | string[] | undefined>): WaiverFilters {
  const flag = (k: string) => {
    const v = raw[k];
    return (Array.isArray(v) ? v[0] : v) === "1";
  };
  const posRaw = Array.isArray(raw.pos) ? raw.pos[0] : raw.pos;
  const pos = posRaw === "F" || posRaw === "D" || posRaw === "G" ? posRaw : "all";
  return {
    pos,
    healthy: flag("healthy"),
    pp: flag("pp"),
    rookies: flag("rookies"),
    tall: flag("tall"),
    iron: flag("iron"),
    rising: flag("rising"),
    watch: flag("watch"),
  };
}

export function waiverBoard(
  ctx: DecisionContext,
  teamId: number | null | undefined,
  filters: WaiverFilters = NO_FILTERS,
): WaiverRow[] {
  const weakest = weakestByGroup(teamRows(ctx, teamId));
  return freeAgentRows(ctx)
    .filter((r) => filters.pos === "all" || r.group === filters.pos)
    .filter((r) => !filters.healthy || !r.injured)
    .filter((r) => !filters.pp || r.bio?.pp === "PP1" || r.bio?.pp === "PP2")
    .filter((r) => !filters.rookies || r.player.source === "rookie" || r.player.source === "rookie_playing")
    .filter((r) => !filters.tall || (r.bio?.heightIn ?? 0) >= TALL_INCHES)
    .filter((r) => !filters.iron || Boolean(r.player.durability?.iron_man))
    .filter((r) => !filters.rising || (r.ownedChange ?? 0) >= RISING_CHANGE)
    .filter((r) => !filters.watch || r.watched)
    .map((r) => {
      const worst = weakest[r.group] ?? null;
      const upgrade = worst && r.value != null && worst.value != null ? r.value - worst.value : null;
      return { ...r, upgrade, replaces: worst };
    })
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
}

// ---------------------------------------------------------------------------
// 2. compare free agents
// ---------------------------------------------------------------------------

export type CompareMetric = {
  key: "value" | "next14" | "ros" | "plays" | "owned" | "age";
  label: string;
  higherIsBetter: boolean;
  get: (r: DecisionRow) => number | null;
};

export const COMPARE_METRICS: CompareMetric[] = [
  { key: "value", label: "Value /G", higherIsBetter: true, get: (r) => r.value },
  { key: "next14", label: "Next 14 days", higherIsBetter: true, get: (r) => r.next14 },
  { key: "ros", label: "Rest of season", higherIsBetter: true, get: (r) => r.ros },
  { key: "plays", label: "Plays", higherIsBetter: true, get: (r) => r.player.durability?.rate ?? null },
  { key: "owned", label: "ESPN % rostered", higherIsBetter: true, get: (r) => r.owned },
  { key: "age", label: "Age", higherIsBetter: false, get: (r) => r.player.age },
];

export type Comparison = {
  rows: DecisionRow[];
  best: Record<CompareMetric["key"], string | null>;
  verdict: string | null;
};

export function parseIds(raw: string | string[] | undefined): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw ?? ""]).flatMap((v) => v.split(","));
  const ids = parts.map((v) => v.trim()).filter((v) => /^\d+$/.test(v));
  return [...new Set(ids)].slice(0, 4);
}

export function compareFreeAgents(ctx: DecisionContext, ids: string[]): Comparison {
  const rows = ids
    .map((id) => {
      const p = ctx.values?.players?.[id];
      return p ? decisionRow(id, p, ctx.bios, ctx.schedule, ctx.start, ctx.prefs?.players[id]) : null;
    })
    .filter((r): r is DecisionRow => r != null);
  const best = {} as Comparison["best"];
  for (const m of COMPARE_METRICS) {
    const scored = rows.filter((r) => m.get(r) != null);
    if (scored.length < 2) {
      best[m.key] = null;
      continue;
    }
    const top = scored.reduce((a, b) =>
      (m.higherIsBetter ? m.get(b)! > m.get(a)! : m.get(b)! < m.get(a)!) ? b : a,
    );
    best[m.key] = top.espnId;
  }
  const name = (id: string | null) => rows.find((r) => r.espnId === id)?.player.name ?? null;
  let verdict: string | null = null;
  if (rows.length >= 2 && best.value) {
    verdict =
      best.next14 && best.next14 !== best.value
        ? `${name(best.value)} is the better player; ${name(best.next14)} scores more over the next 14 days.`
        : `${name(best.value)} is the pick — best value${best.next14 ? " and best next 14 days" : ""}.`;
  }
  return { rows, best, verdict };
}

// ---------------------------------------------------------------------------
// 3. evaluate a move
// ---------------------------------------------------------------------------

export type MoveEvaluation = {
  drop: DecisionRow;
  add: DecisionRow;
  delta: { value: number | null; next14: number | null; ros: number | null; plays: number | null };
  warnings: string[];
  verdict: string;
};

function diff(a: number | null, b: number | null): number | null {
  return a == null || b == null ? null : a - b;
}

export function evaluateMove(
  ctx: DecisionContext,
  teamId: number | null | undefined,
  dropId: string | null | undefined,
  addId: string | null | undefined,
): MoveEvaluation | null {
  const roster = teamRows(ctx, teamId);
  const drop = roster.find((r) => r.espnId === dropId);
  const add = freeAgentRows(ctx).find((r) => r.espnId === addId);
  if (!drop || !add) return null;
  const warnings: string[] = [];
  const goaliesAfter =
    roster.filter((r) => r.group === "G").length - (drop.group === "G" ? 1 : 0) + (add.group === "G" ? 1 : 0);
  if (goaliesAfter > MAX_GOALIES) {
    warnings.push(`That leaves ${goaliesAfter} goalies — the league allows ${MAX_GOALIES}.`);
  }
  if (add.injured) {
    const why = add.bio?.injury?.toUpperCase() || String(add.player.injury_status ?? "").replace(/_/g, " ");
    warnings.push(`${add.player.name} is injured (${why}).`);
  }
  if (drop.group !== add.group) {
    warnings.push(`Different position group (${drop.group} → ${add.group}); check your lineup slots.`);
  }
  if (drop.kept) {
    warnings.push(`You tagged ${drop.player.name} Keep (never drop).`);
  } else if (drop.protected) {
    warnings.push(
      `${drop.player.name} is rostered in ${drop.owned!.toFixed(0)}% of ESPN leagues — protected (${PROTECT_OWNED}%+); think twice.`,
    );
  }
  if (add.bio?.possibleScratch) {
    warnings.push(`${add.player.name} may be a healthy scratch next game (Daily Faceoff).`);
  }
  const delta = {
    value: diff(add.value, drop.value),
    next14: diff(add.next14, drop.next14),
    ros: diff(add.ros, drop.ros),
    plays: diff(add.player.durability?.rate ?? null, drop.player.durability?.rate ?? null),
  };
  const better = (delta.ros ?? delta.value ?? 0) > 0;
  const verdict = better
    ? `Adding ${add.player.name} for ${drop.player.name} gains ${
        delta.ros != null ? `${delta.ros.toFixed(1)} rest-of-season points` : "value"
      }.`
    : `${drop.player.name} is worth more than ${add.player.name} — keep ${drop.player.name}.`;
  return { drop, add, delta, warnings, verdict };
}

// ---------------------------------------------------------------------------
// 4. weakest to best
// ---------------------------------------------------------------------------

export type DepthGroup = { group: Group; label: string; rows: DecisionRow[]; max: number };

export function depthChart(ctx: DecisionContext, teamId: number | null | undefined): DepthGroup[] {
  const rows = teamRows(ctx, teamId);
  const labels: Record<Group, string> = { F: "Forwards", D: "Defense", G: "Goalies" };
  return (["F", "D", "G"] as const)
    .map((group) => {
      const inGroup = rows
        .filter((r) => r.group === group)
        .sort((a, b) => (a.value ?? -Infinity) - (b.value ?? -Infinity));
      return {
        group,
        label: labels[group],
        rows: inGroup,
        max: Math.max(0, ...inGroup.map((r) => r.value ?? 0)),
      };
    })
    .filter((g) => g.rows.length > 0);
}

/** "+0.42" / "−0.10" / "—". */
export function formatDelta(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = Math.abs(v).toFixed(digits);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}
