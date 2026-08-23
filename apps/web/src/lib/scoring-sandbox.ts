/**
 * League Manager scoring sandbox (roadmap 8.4).
 *
 * Pure rescoring over stored snapshot lines + a cloned weight map.
 * Does not call ESPN, ffa, or write league settings.
 *
 * Football: official week totals stay ESPN ``home_score`` / ``away_score``.
 * Tweaks apply as Δ = Σ (w_new − w_old) × starter stats, so incomplete
 * lineups and unmodeled K/DST keep a residual instead of inventing points.
 *
 * Baseball season-points: same Δ over roster ``season_stats``.
 * Baseball H2H cats: recompute period cat W/L and roto ranks from stored
 * cat values — never a fake points total.
 *
 * Golf: re-keep Thu/Fri slots and optional drop-worst from scoreboard
 * slot points already on the snapshot.
 */

import { isStarterSlot } from "@/lib/box-score";
import type {
  BoxScoreMatchup,
  BoxScorePlayer,
  GolfScoreboardEvent,
  GolfScoreboardTeamWeek,
  LeagueSnapshot,
  ScoringFormatRow,
  Team,
  WeekBoxScoreSnapshot,
} from "@/lib/data";
import { DEFAULT_GOLF_SETTINGS, parseGolfSettings } from "@/lib/golf";
import {
  aggregateTeamCounting,
  baseballCategoriesForLeague,
  categoryValue,
  type CategoryDef,
  type TeamCountingTotals,
} from "@/lib/baseball-tools";
import {
  isCategoryScoring,
  isSeasonPointsScoring,
} from "@/lib/scoring-type";

export type SandboxItemKind = "weight" | "toggle" | "count" | "multiplier";

export type SandboxScoringItem = {
  key: string;
  label: string;
  official: number;
  kind: SandboxItemKind;
  step: number;
  min: number;
  max: number;
  /** True when the item came from box/roster stats, not settings. */
  inferred?: boolean;
};

export type SandboxTeam = {
  teamId: number;
  name: string;
  abbrev: string | null;
  officialPoints: number | null;
  officialStanding: number | null;
  wins: number;
  losses: number;
  ties: number;
};

export type FootballTeamWeek = {
  teamId: number;
  opponentId: number | null;
  officialScore: number;
  stats: Record<string, number>;
  officialOutcome: "W" | "L" | "T" | "U";
  isHome: boolean;
};

export type FootballWeekSlice = {
  week: number;
  teams: FootballTeamWeek[];
};

export type BaseballTeamCounts = {
  teamId: number;
  name: string;
  officialPoints: number | null;
  officialStanding: number | null;
  stats: Record<string, number>;
};

export type BaseballPeriodMatchup = {
  week: number;
  homeId: number;
  awayId: number;
  homeStats: Record<string, number>;
  awayStats: Record<string, number>;
  officialHomeWins: number;
  officialHomeLosses: number;
  officialHomeTies: number;
};

export type GolfSandboxRound = {
  round: number;
  weekend: boolean;
  points: number[];
};

export type GolfSandboxTeamWeek = {
  officialTotal: number;
  rounds: GolfSandboxRound[];
  golferWeek: number[];
  captainWeek: number;
};

export type GolfSandboxEvent = {
  eventId: string;
  name: string;
  multiplierTier: string;
  officialMultiplier: number;
  pairings: Array<{
    homeId: number;
    awayId: number;
    officialOutcome: string;
  }>;
  teams: Record<string, GolfSandboxTeamWeek>;
};

export type ScoringSandboxModel = {
  leagueId: string;
  season: number;
  sport: "football" | "baseball" | "golf" | string;
  scoringType: string | null;
  name: string;
  periodLabel: string;
  items: SandboxScoringItem[];
  teams: SandboxTeam[];
  disclaimer: string;
  football?: { weeks: FootballWeekSlice[] };
  baseball?: {
    mode: "season_points" | "category";
    teams: BaseballTeamCounts[];
    periods: BaseballPeriodMatchup[];
    invertKeys: string[];
    categories: CategoryDef[];
  };
  golf?: {
    events: GolfSandboxEvent[];
    captainTiebreaker: boolean;
    official: {
      thuFriCount: number;
      satSunCount: number;
      dropWorst: boolean;
      multipliers: { regular: number; signature: number; major: number };
    };
  };
};

export type FootballSimTeam = {
  teamId: number;
  name: string;
  official: number;
  simulated: number;
  delta: number;
  statDeltas: Record<string, number>;
};

export type FootballSimMatchup = {
  week: number;
  homeId: number;
  awayId: number;
  homeOfficial: number;
  awayOfficial: number;
  homeSim: number;
  awaySim: number;
  officialOutcome: "W" | "L" | "T" | "U";
  simulatedOutcome: "W" | "L" | "T";
  flipped: boolean;
};

export type FootballSimResult = {
  week: number | null;
  teams: FootballSimTeam[];
  matchups: FootballSimMatchup[];
};

export type BaseballSimTeam = {
  teamId: number;
  name: string;
  official: number;
  simulated: number;
  delta: number;
  officialRank: number | null;
  simulatedRank: number;
  rankDelta: number | null;
  statDeltas: Record<string, number>;
  catWins?: number;
  catLosses?: number;
  catTies?: number;
  rotoOfficial?: number;
  rotoSimulated?: number;
};

export type BaseballCatFlip = {
  week: number;
  homeId: number;
  awayId: number;
  key: string;
  official: "W" | "L" | "T";
  simulated: "W" | "L" | "T";
};

export type BaseballSimResult = {
  mode: "season_points" | "category";
  teams: BaseballSimTeam[];
  flips: BaseballCatFlip[];
};

export type GolfSimTeam = {
  teamId: number;
  name: string;
  official: number;
  simulated: number;
  delta: number;
  officialRank: number | null;
  simulatedRank: number;
};

export type GolfSimMatchup = {
  eventId: string;
  homeId: number;
  awayId: number;
  officialOutcome: string;
  simulatedOutcome: "W" | "L" | "T";
  flipped: boolean;
};

export type GolfSimResult = {
  teams: GolfSimTeam[];
  matchups: GolfSimMatchup[];
};

export type GolfSandboxTweaks = {
  thuFriCount: number;
  satSunCount: number;
  dropWorst: boolean;
  multipliers: { regular: number; signature: number; major: number };
};

export type SandboxTweaks = {
  weights: Record<string, number>;
  enabled: Record<string, boolean>;
  golf: GolfSandboxTweaks;
};

const FOOTBALL_EXTRA_KEYS = [
  "PY",
  "PTD",
  "INT",
  "RY",
  "RTD",
  "REY",
  "REC",
  "RETD",
  "FUML",
] as const;

const BASEBALL_STAT_KEYS = [
  "R",
  "HR",
  "RBI",
  "SB",
  "H",
  "AB",
  "W",
  "L",
  "SV",
  "HLD",
  "QS",
  "K",
  "OUTS",
  "IP",
] as const;

const INVERT_CATS = new Set(["ERA", "WHIP", "B_SO", "L", "ER", "P_H", "P_BB"]);

const ITEM_LABELS: Record<string, string> = {
  PY: "Passing Yards",
  PTD: "Passing TD",
  INT: "Interceptions",
  RY: "Rushing Yards",
  RTD: "Rushing TD",
  REY: "Receiving Yards",
  REC: "Receptions (PPR)",
  RETD: "Receiving TD",
  FUML: "Fumbles Lost",
  FUM: "Fumbles",
};

function num(value: number | null | undefined): number {
  return typeof value === "number" && !Number.isNaN(value) ? value : 0;
}

function itemKey(row: ScoringFormatRow): string | null {
  const abbr = row.abbr?.trim();
  if (abbr) return abbr.toUpperCase();
  const label = row.label?.trim();
  if (label) return label.toUpperCase();
  if (row.id != null) return String(row.id);
  return null;
}

export function officialWeightMap(league: LeagueSnapshot): Record<string, number> {
  const rows = [
    ...(league.settings?.scoring_format ?? []),
    ...(league.settings?.categories ?? []),
  ];
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = itemKey(row);
    if (!key) continue;
    if (row.points == null || Number.isNaN(row.points)) continue;
    out[key] = row.points;
  }
  return out;
}

export function applyWeightDelta(
  officialTotal: number,
  stats: Record<string, number>,
  officialWeights: Record<string, number>,
  tweakedWeights: Record<string, number>,
): number {
  let delta = 0;
  const keys = new Set([
    ...Object.keys(officialWeights),
    ...Object.keys(tweakedWeights),
    ...Object.keys(stats),
  ]);
  for (const key of keys) {
    const oldW = officialWeights[key] ?? 0;
    const newW = tweakedWeights[key] ?? 0;
    if (oldW === newW) continue;
    delta += (newW - oldW) * (stats[key] ?? 0);
  }
  return officialTotal + delta;
}

export function statDeltas(
  stats: Record<string, number>,
  officialWeights: Record<string, number>,
  tweakedWeights: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const keys = new Set([
    ...Object.keys(officialWeights),
    ...Object.keys(tweakedWeights),
    ...Object.keys(stats),
  ]);
  for (const key of keys) {
    const oldW = officialWeights[key] ?? 0;
    const newW = tweakedWeights[key] ?? 0;
    const d = (newW - oldW) * (stats[key] ?? 0);
    if (d !== 0) out[key] = d;
  }
  return out;
}

export function outcomeFromScores(
  home: number,
  away: number,
): "W" | "L" | "T" {
  if (home > away) return "W";
  if (home < away) return "L";
  return "T";
}

function flipLabel(
  official: "W" | "L" | "T" | "U",
  simulated: "W" | "L" | "T",
): boolean {
  if (official === "U") return false;
  return official !== simulated;
}

function playerStats(player: BoxScorePlayer): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(player.stats ?? {})) {
    if (value == null || Number.isNaN(value)) continue;
    out[key.toUpperCase()] = value;
  }
  return out;
}

export function aggregateStarterStats(
  lineup: BoxScorePlayer[] | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const player of lineup ?? []) {
    if (!isStarterSlot(player.slot)) continue;
    for (const [key, value] of Object.entries(playerStats(player))) {
      out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}

function mergeStats(
  ...rows: Array<Record<string, number>>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}

function footballWeightItem(
  key: string,
  official: number,
  inferred = false,
): SandboxScoringItem {
  const abs = Math.abs(official);
  const step = abs > 0 && abs < 1 ? 0.01 : 0.5;
  return {
    key,
    label: ITEM_LABELS[key] ?? key,
    official,
    kind: "weight",
    step,
    min: -10,
    max: 20,
    inferred,
  };
}

function baseballSeasonStats(team: Team): Record<string, number> {
  const totals = aggregateTeamCounting(team);
  const out: Record<string, number> = {
    R: totals.r,
    HR: totals.hr,
    RBI: totals.rbi,
    SB: totals.sb,
    H: totals.h,
    AB: totals.ab,
    W: totals.w,
    SV: totals.sv,
    K: totals.k,
    OUTS: totals.outs,
    IP: totals.outs / 3,
    ER: totals.er,
    WH: totals.wh,
  };
  for (const player of team.roster ?? []) {
    const s = player.season_stats;
    if (!s) continue;
    out.L = (out.L ?? 0) + num(s.L);
    out.HLD = (out.HLD ?? 0) + num(s.HLD);
    out.QS = (out.QS ?? 0) + num(s.QS);
  }
  return out;
}

function sideCatValues(
  stats: Record<string, { value?: number | null } | undefined> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, cell] of Object.entries(stats ?? {})) {
    if (cell?.value == null || Number.isNaN(cell.value)) continue;
    out[key.toUpperCase()] = cell.value;
  }
  return out;
}

function golfRoundSlots(week: GolfScoreboardTeamWeek): GolfSandboxRound[] {
  const rounds: GolfSandboxRound[] = [];
  for (const raw of Object.values(week.by_round ?? {})) {
    const points = (raw.slots ?? []).map((slot) => num(slot.points));
    if (!points.length) continue;
    rounds.push({
      round: raw.round,
      weekend: raw.round >= 3,
      points,
    });
  }
  rounds.sort((a, b) => a.round - b.round);
  return rounds;
}

function golferWeekFromRounds(rounds: GolfSandboxRound[], keepN: number): number[] {
  const n = Math.max(0, ...rounds.map((r) => r.points.length));
  const totals = Array.from({ length: n }, () => 0);
  for (const round of rounds) {
    const counted = new Set<number>();
    if (!round.weekend) {
      const ranked = round.points
        .map((pts, index) => ({ pts, index }))
        .sort((a, b) => b.pts - a.pts || a.index - b.index);
      for (const row of ranked.slice(0, keepN)) counted.add(row.index);
    } else {
      round.points.forEach((_, index) => counted.add(index));
    }
    for (const index of counted) {
      totals[index] = (totals[index] ?? 0) + (round.points[index] ?? 0);
    }
  }
  return totals;
}

export function scoreGolfWeek(
  team: GolfSandboxTeamWeek,
  tweaks: GolfSandboxTweaks,
  officialMultiplier: number,
  tier: string,
): { total: number; captainWeek: number } {
  const keepN = Math.max(1, Math.trunc(tweaks.thuFriCount));
  let raw = 0;
  const golfer = golferWeekFromRounds(team.rounds, keepN);
  for (const round of team.rounds) {
    if (round.weekend) {
      const keepWeekend = Math.max(1, Math.trunc(tweaks.satSunCount));
      const ranked = round.points
        .map((pts, index) => ({ pts, index }))
        .sort((a, b) => b.pts - a.pts || a.index - b.index);
      raw += ranked
        .slice(0, Math.min(keepWeekend, ranked.length))
        .reduce((sum, row) => sum + row.pts, 0);
    } else {
      const ranked = round.points
        .map((pts, index) => ({ pts, index }))
        .sort((a, b) => b.pts - a.pts || a.index - b.index);
      raw += ranked
        .slice(0, Math.min(keepN, ranked.length))
        .reduce((sum, row) => sum + row.pts, 0);
    }
  }
  if (tweaks.dropWorst && golfer.length) {
    const worst = Math.min(...golfer);
    raw -= worst;
  }
  const key = (tier || "regular").toLowerCase() as keyof GolfSandboxTweaks["multipliers"];
  const multiplier = tweaks.multipliers[key] ?? officialMultiplier;
  return { total: raw * multiplier, captainWeek: team.captainWeek };
}

function rankBy(
  rows: Array<{ teamId: number; value: number }>,
): Map<number, number> {
  const sorted = [...rows].sort(
    (a, b) => b.value - a.value || a.teamId - b.teamId,
  );
  const ranks = new Map<number, number>();
  sorted.forEach((row, i) => ranks.set(row.teamId, i + 1));
  return ranks;
}

export function compareCategory(
  home: number,
  away: number,
  invert: boolean,
): "W" | "L" | "T" {
  if (home === away) return "T";
  const homeBetter = invert ? home < away : home > away;
  return homeBetter ? "W" : "L";
}

export function defaultTweaks(model: ScoringSandboxModel): SandboxTweaks {
  const weights: Record<string, number> = {};
  const enabled: Record<string, boolean> = {};
  for (const item of model.items) {
    if (item.kind === "toggle") enabled[item.key] = item.official > 0;
    else weights[item.key] = item.official;
  }
  return {
    weights,
    enabled,
    golf: model.golf?.official
      ? { ...model.golf.official, multipliers: { ...model.golf.official.multipliers } }
      : {
          thuFriCount: 4,
          satSunCount: 5,
          dropWorst: false,
          multipliers: { regular: 1, signature: 1.5, major: 2 },
        },
  };
}

export function sandboxStorageKey(leagueId: string, season: number): string {
  return `sj-scoring-sandbox:${leagueId}:${season}`;
}

export function buildScoringSandboxModel(
  league: LeagueSnapshot,
  weeks: WeekBoxScoreSnapshot[] = [],
): ScoringSandboxModel {
  const teams: SandboxTeam[] = league.teams.map((team) => ({
    teamId: team.team_id,
    name: team.name,
    abbrev: team.abbrev,
    officialPoints: team.points_for,
    officialStanding: team.standing,
    wins: team.wins,
    losses: team.losses,
    ties: team.ties,
  }));

  if (league.sport === "golf") {
    return buildGolfModel(league, teams);
  }
  if (league.sport === "baseball") {
    return buildBaseballModel(league, teams, weeks);
  }
  return buildFootballModel(league, teams, weeks);
}

function buildFootballModel(
  league: LeagueSnapshot,
  teams: SandboxTeam[],
  weeks: WeekBoxScoreSnapshot[],
): ScoringSandboxModel {
  const official = officialWeightMap(league);
  const items: SandboxScoringItem[] = Object.entries(official).map(([key, value]) =>
    footballWeightItem(key, value),
  );
  const seen = new Set(items.map((i) => i.key));
  const weekSlices: FootballWeekSlice[] = [];
  const extraKeys = new Set<string>();

  for (const snap of weeks) {
    if (snap.sport && snap.sport !== "football") continue;
    const byTeam = new Map<number, FootballTeamWeek>();
    for (const matchup of snap.matchups ?? []) {
      addFootballSide(byTeam, matchup, "home", extraKeys);
      addFootballSide(byTeam, matchup, "away", extraKeys);
    }
    weekSlices.push({
      week: snap.week,
      teams: [...byTeam.values()].sort((a, b) => a.teamId - b.teamId),
    });
  }

  for (const key of [...FOOTBALL_EXTRA_KEYS, ...extraKeys]) {
    if (seen.has(key)) continue;
    items.push(footballWeightItem(key, official[key] ?? 0, !(key in official)));
    seen.add(key);
  }

  const weekList = weekSlices.map((w) => w.week).join(", ") || "none";
  return {
    leagueId: league.league_id,
    season: league.season,
    sport: "football",
    scoringType: league.scoring_type ?? league.settings?.scoring_type ?? null,
    name: league.name,
    periodLabel: league.period_label || "week",
    items,
    teams,
    football: { weeks: weekSlices },
    disclaimer:
      `Sandbox only — ESPN is unchanged. Week points start from stored box scores (${weekList}). ` +
      `Tweaks apply to starter stat lines; bench and missing stats stay in the residual. ` +
      `Season rows sum stored weeks, not the full ESPN points-for tape.`,
  };
}

function addFootballSide(
  byTeam: Map<number, FootballTeamWeek>,
  matchup: BoxScoreMatchup,
  side: "home" | "away",
  extraKeys: Set<string>,
): void {
  const teamId = side === "home" ? matchup.home_team_id : matchup.away_team_id;
  const oppId = side === "home" ? matchup.away_team_id : matchup.home_team_id;
  const officialScore =
    side === "home" ? num(matchup.home_score) : num(matchup.away_score);
  const oppScore =
    side === "home" ? num(matchup.away_score) : num(matchup.home_score);
  if (teamId == null) return;
  const lineup = side === "home" ? matchup.home_lineup : matchup.away_lineup;
  const stats = aggregateStarterStats(lineup);
  for (const key of Object.keys(stats)) extraKeys.add(key);
  const officialOutcome =
    teamId === oppId
      ? "U"
      : outcomeFromScores(officialScore, oppScore);
  byTeam.set(teamId, {
    teamId,
    opponentId: oppId,
    officialScore,
    stats,
    officialOutcome,
    isHome: side === "home",
  });
}

function buildBaseballModel(
  league: LeagueSnapshot,
  teams: SandboxTeam[],
  weeks: WeekBoxScoreSnapshot[],
): ScoringSandboxModel {
  const official = officialWeightMap(league);
  const categoryMode = isCategoryScoring(
    league.scoring_type ?? league.settings?.scoring_type,
  );
  const seasonPoints = isSeasonPointsScoring(
    league.scoring_type ?? league.settings?.scoring_type,
  );
  const mode: "season_points" | "category" =
    categoryMode && !seasonPoints ? "category" : "season_points";

  const items: SandboxScoringItem[] = [];
  const seen = new Set<string>();
  if (mode === "season_points") {
    for (const [key, value] of Object.entries(official)) {
      items.push({
        key,
        label: key,
        official: value,
        kind: "weight",
        step: Math.abs(value) >= 1 ? 0.5 : 0.1,
        min: -10,
        max: 20,
      });
      seen.add(key);
    }
    for (const key of BASEBALL_STAT_KEYS) {
      if (seen.has(key)) continue;
      items.push({
        key,
        label: key,
        official: official[key] ?? 0,
        kind: "weight",
        step: 0.5,
        min: -10,
        max: 20,
        inferred: !(key in official),
      });
      seen.add(key);
    }
  } else {
    const cats = baseballCategoriesForLeague(league);
    for (const cat of cats) {
      items.push({
        key: cat.id,
        label: cat.label,
        official: 1,
        kind: "toggle",
        step: 1,
        min: 0,
        max: 1,
      });
    }
  }

  const counting: BaseballTeamCounts[] = league.teams.map((team) => ({
    teamId: team.team_id,
    name: team.name,
    officialPoints: team.points_for,
    officialStanding: team.standing,
    stats: baseballSeasonStats(team),
  }));

  const periods: BaseballPeriodMatchup[] = [];
  for (const snap of weeks) {
    if (snap.sport && snap.sport !== "baseball") continue;
    for (const matchup of snap.matchups ?? []) {
      if (matchup.home_team_id == null || matchup.away_team_id == null) continue;
      const homeStats = sideCatValues(matchup.home_stats);
      const awayStats = sideCatValues(matchup.away_stats);
      if (!Object.keys(homeStats).length && !Object.keys(awayStats).length) {
        continue;
      }
      periods.push({
        week: snap.week,
        homeId: matchup.home_team_id,
        awayId: matchup.away_team_id,
        homeStats,
        awayStats,
        officialHomeWins: matchup.home_wins ?? 0,
        officialHomeLosses: matchup.home_losses ?? 0,
        officialHomeTies: matchup.home_ties ?? 0,
      });
    }
  }

  return {
    leagueId: league.league_id,
    season: league.season,
    sport: "baseball",
    scoringType: league.scoring_type ?? league.settings?.scoring_type ?? null,
    name: league.name,
    periodLabel: league.period_label || "period",
    items,
    teams,
    baseball: {
      mode,
      teams: counting,
      periods,
      invertKeys: [...INVERT_CATS],
      categories: baseballCategoriesForLeague(league),
    },
    disclaimer:
      mode === "category"
        ? "Sandbox only — ESPN is unchanged. Category wins recompute from stored period boxes and season roster counting stats. Rate stats (AVG/ERA/WHIP) stay inverted. This is not an MLB projection model."
        : "Sandbox only — ESPN is unchanged. Season Points reweight roster counting stats that exist on the snapshot (HR, R, RBI, K, …). Cats without a stored line (1B, BB, …) stay in the residual against ESPN points-for.",
  };
}

function buildGolfModel(
  league: LeagueSnapshot,
  teams: SandboxTeam[],
): ScoringSandboxModel {
  const golf = parseGolfSettings(league.settings) ?? DEFAULT_GOLF_SETTINGS;
  const events: GolfSandboxEvent[] = [];
  for (const event of league.scoreboard?.events ?? []) {
    events.push(compactGolfEvent(event));
  }
  const items: SandboxScoringItem[] = [
    {
      key: "thu_fri_count",
      label: "Thu/Fri keep",
      official: golf.scoring.thu_fri_count,
      kind: "count",
      step: 1,
      min: 1,
      max: 5,
    },
    {
      key: "sat_sun_count",
      label: "Sat/Sun keep",
      official: golf.scoring.sat_sun_count,
      kind: "count",
      step: 1,
      min: 1,
      max: 5,
    },
    {
      key: "drop_worst_golfer",
      label: "Drop worst golfer",
      official: golf.scoring.drop_worst_golfer ? 1 : 0,
      kind: "toggle",
      step: 1,
      min: 0,
      max: 1,
    },
    {
      key: "multiplier.regular",
      label: "Regular multiplier",
      official: golf.multipliers.regular,
      kind: "multiplier",
      step: 0.25,
      min: 0.5,
      max: 4,
    },
    {
      key: "multiplier.signature",
      label: "Signature multiplier",
      official: golf.multipliers.signature,
      kind: "multiplier",
      step: 0.25,
      min: 0.5,
      max: 4,
    },
    {
      key: "multiplier.major",
      label: "Major multiplier",
      official: golf.multipliers.major,
      kind: "multiplier",
      step: 0.25,
      min: 0.5,
      max: 4,
    },
  ];
  return {
    leagueId: league.league_id,
    season: league.season,
    sport: "golf",
    scoringType: league.scoring_type ?? "GOLF_COUNTING",
    name: league.name,
    periodLabel: league.period_label || "event",
    items,
    teams,
    golf: {
      events,
      captainTiebreaker: golf.captain_tiebreaker,
      official: {
        thuFriCount: golf.scoring.thu_fri_count,
        satSunCount: golf.scoring.sat_sun_count,
        dropWorst: golf.scoring.drop_worst_golfer,
        multipliers: { ...golf.multipliers },
      },
    },
    disclaimer:
      events.length
        ? "Sandbox only — hub golf settings are not written. Week totals re-keep stored EOD slot points (best N midweek, optional drop-worst, event multipliers). No live tour feed."
        : "Sandbox only. This snapshot has no scoreboard events to rescore — counting knobs still edit locally.",
  };
}

function compactGolfEvent(event: GolfScoreboardEvent): GolfSandboxEvent {
  const teams: Record<string, GolfSandboxTeamWeek> = {};
  for (const [tid, week] of Object.entries(event.teams ?? {})) {
    teams[tid] = {
      officialTotal: num(week.week_total),
      rounds: golfRoundSlots(week),
      golferWeek: Object.values(week.by_round ?? {}).length
        ? golferWeekFromRounds(
            golfRoundSlots(week),
            5,
          )
        : [],
      captainWeek: num(week.captain_week),
    };
  }
  return {
    eventId: event.event_id,
    name: event.name ?? event.event_id,
    multiplierTier: event.multiplier_tier,
    officialMultiplier: event.multiplier,
    pairings: (event.pairings ?? []).map((pair) => ({
      homeId: pair.home_team_id,
      awayId: pair.away_team_id,
      officialOutcome: pair.outcome,
    })),
    teams,
  };
}

export function simulateFootball(
  model: ScoringSandboxModel,
  weights: Record<string, number>,
  week: number | null,
): FootballSimResult {
  const official = Object.fromEntries(
    model.items.map((item) => [item.key, item.official]),
  );
  const slices = model.football?.weeks ?? [];
  const selected = week == null ? slices : slices.filter((s) => s.week === week);
  const statsByTeam = new Map<number, Record<string, number>>();
  const officialByTeam = new Map<number, number>();
  const matchups: FootballSimMatchup[] = [];

  for (const slice of selected) {
    const byId = new Map(slice.teams.map((t) => [t.teamId, t]));
    const seen = new Set<string>();
    for (const row of slice.teams) {
      statsByTeam.set(
        row.teamId,
        mergeStats(statsByTeam.get(row.teamId) ?? {}, row.stats),
      );
      officialByTeam.set(
        row.teamId,
        (officialByTeam.get(row.teamId) ?? 0) + row.officialScore,
      );
      if (!row.isHome || row.opponentId == null) continue;
      const key = `${slice.week}:${row.teamId}:${row.opponentId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const opp = byId.get(row.opponentId);
      if (!opp) continue;
      const homeSim = applyWeightDelta(
        row.officialScore,
        row.stats,
        official,
        weights,
      );
      const awaySim = applyWeightDelta(
        opp.officialScore,
        opp.stats,
        official,
        weights,
      );
      const simulatedOutcome = outcomeFromScores(homeSim, awaySim);
      matchups.push({
        week: slice.week,
        homeId: row.teamId,
        awayId: opp.teamId,
        homeOfficial: row.officialScore,
        awayOfficial: opp.officialScore,
        homeSim,
        awaySim,
        officialOutcome: row.officialOutcome,
        simulatedOutcome,
        flipped: flipLabel(row.officialOutcome, simulatedOutcome),
      });
    }
  }

  const teamRows: FootballSimTeam[] = model.teams.map((team) => {
    const stats = statsByTeam.get(team.teamId) ?? {};
    const officialTotal = officialByTeam.get(team.teamId);
    const base =
      officialTotal ??
      (week == null ? num(team.officialPoints) : 0);
    const simulated = applyWeightDelta(base, stats, official, weights);
    return {
      teamId: team.teamId,
      name: team.name,
      official: base,
      simulated,
      delta: simulated - base,
      statDeltas: statDeltas(stats, official, weights),
    };
  });

  return {
    week,
    teams: teamRows.sort((a, b) => b.simulated - a.simulated || a.teamId - b.teamId),
    matchups: matchups.sort((a, b) => a.week - b.week || a.homeId - b.homeId),
  };
}

export function simulateBaseball(
  model: ScoringSandboxModel,
  tweaks: SandboxTweaks,
): BaseballSimResult {
  const bb = model.baseball;
  if (!bb) {
    return { mode: "season_points", teams: [], flips: [] };
  }
  if (bb.mode === "category") {
    return simulateBaseballCats(model, tweaks);
  }
  const official = Object.fromEntries(
    model.items.map((item) => [item.key, item.official]),
  );
  const rows: BaseballSimTeam[] = bb.teams.map((team) => {
    const base = num(team.officialPoints);
    const simulated = applyWeightDelta(base, team.stats, official, tweaks.weights);
    return {
      teamId: team.teamId,
      name: team.name,
      official: base,
      simulated,
      delta: simulated - base,
      officialRank: team.officialStanding,
      simulatedRank: 0,
      rankDelta: null,
      statDeltas: statDeltas(team.stats, official, tweaks.weights),
    };
  });
  const ranks = rankBy(rows.map((r) => ({ teamId: r.teamId, value: r.simulated })));
  for (const row of rows) {
    row.simulatedRank = ranks.get(row.teamId) ?? rows.length;
    row.rankDelta =
      row.officialRank != null ? row.officialRank - row.simulatedRank : null;
  }
  return {
    mode: "season_points",
    teams: rows.sort((a, b) => a.simulatedRank - b.simulatedRank),
    flips: [],
  };
}

function countingFromSandbox(team: BaseballTeamCounts): TeamCountingTotals {
  return {
    teamId: team.teamId,
    name: team.name,
    ab: team.stats.AB ?? 0,
    h: team.stats.H ?? 0,
    r: team.stats.R ?? 0,
    hr: team.stats.HR ?? 0,
    rbi: team.stats.RBI ?? 0,
    sb: team.stats.SB ?? 0,
    w: team.stats.W ?? 0,
    sv: team.stats.SV ?? 0,
    k: team.stats.K ?? 0,
    outs: team.stats.OUTS ?? 0,
    er: team.stats.ER ?? 0,
    wh: team.stats.WH ?? 0,
  };
}

function rotoPointsForCats(
  teams: BaseballTeamCounts[],
  cats: CategoryDef[],
): Map<number, number> {
  const n = Math.max(teams.length, 1);
  const roto = new Map<number, number>();
  for (const team of teams) roto.set(team.teamId, 0);
  for (const cat of cats) {
    const values = teams.map((t) => ({
      teamId: t.teamId,
      value: categoryValue(countingFromSandbox(t), cat),
    }));
    const scored = values
      .filter((v): v is { teamId: number; value: number } => v.value != null)
      .sort((a, b) =>
        cat.higherIsBetter ? b.value - a.value : a.value - b.value,
      );
    let i = 0;
    while (i < scored.length) {
      let j = i;
      while (j < scored.length && scored[j]!.value === scored[i]!.value) j += 1;
      const pts = (n - i + n - j + 1) / 2;
      for (let k = i; k < j; k += 1) {
        const id = scored[k]!.teamId;
        roto.set(id, (roto.get(id) ?? 0) + pts);
      }
      i = j;
    }
  }
  return roto;
}

function simulateBaseballCats(
  model: ScoringSandboxModel,
  tweaks: SandboxTweaks,
): BaseballSimResult {
  const bb = model.baseball!;
  const enabled = bb.categories.filter((cat) => tweaks.enabled[cat.id] !== false);
  const invert = new Set(bb.invertKeys);
  const flips: BaseballCatFlip[] = [];
  const record = new Map<number, { w: number; l: number; t: number }>();
  for (const team of bb.teams) {
    record.set(team.teamId, { w: 0, l: 0, t: 0 });
  }

  for (const period of bb.periods) {
    let homeW = 0;
    let homeL = 0;
    let homeT = 0;
    for (const cat of bb.categories) {
      const home = period.homeStats[cat.id];
      const away = period.awayStats[cat.id];
      if (home == null || away == null) continue;
      const invertCat = invert.has(cat.id) || !cat.higherIsBetter;
      const official = compareCategory(home, away, invertCat);
      const on = tweaks.enabled[cat.id] !== false;
      const sim = on ? official : "T";
      if (on) {
        if (sim === "W") homeW += 1;
        else if (sim === "L") homeL += 1;
        else homeT += 1;
      }
      if (official !== sim) {
        flips.push({
          week: period.week,
          homeId: period.homeId,
          awayId: period.awayId,
          key: cat.id,
          official,
          simulated: sim,
        });
      }
    }
    const homeRec = record.get(period.homeId);
    const awayRec = record.get(period.awayId);
    if (homeRec) {
      homeRec.w += homeW;
      homeRec.l += homeL;
      homeRec.t += homeT;
    }
    if (awayRec) {
      awayRec.w += homeL;
      awayRec.l += homeW;
      awayRec.t += homeT;
    }
  }

  const rotoOfficial = rotoPointsForCats(bb.teams, bb.categories);
  const rotoSim = rotoPointsForCats(bb.teams, enabled);

  const rows: BaseballSimTeam[] = bb.teams.map((team) => {
    const rec = record.get(team.teamId) ?? { w: 0, l: 0, t: 0 };
    const officialRoto = rotoOfficial.get(team.teamId) ?? 0;
    const simRoto = rotoSim.get(team.teamId) ?? 0;
    return {
      teamId: team.teamId,
      name: team.name,
      official: officialRoto,
      simulated: simRoto,
      delta: simRoto - officialRoto,
      officialRank: team.officialStanding,
      simulatedRank: 0,
      rankDelta: null,
      statDeltas: {},
      catWins: rec.w,
      catLosses: rec.l,
      catTies: rec.t,
      rotoOfficial: officialRoto,
      rotoSimulated: simRoto,
    };
  });
  const ranks = rankBy(rows.map((r) => ({ teamId: r.teamId, value: r.simulated })));
  for (const row of rows) {
    row.simulatedRank = ranks.get(row.teamId) ?? rows.length;
    row.rankDelta =
      row.officialRank != null ? row.officialRank - row.simulatedRank : null;
  }

  return {
    mode: "category",
    teams: rows.sort((a, b) => a.simulatedRank - b.simulatedRank),
    flips,
  };
}

export function simulateGolf(
  model: ScoringSandboxModel,
  tweaks: GolfSandboxTweaks,
): GolfSimResult {
  const golf = model.golf;
  if (!golf) return { teams: [], matchups: [] };
  const totals = new Map<number, { official: number; simulated: number }>();
  for (const team of model.teams) {
    totals.set(team.teamId, { official: num(team.officialPoints), simulated: 0 });
  }
  const matchups: GolfSimMatchup[] = [];
  for (const event of golf.events) {
    const weekTotals = new Map<number, { official: number; sim: number; captain: number }>();
    for (const [tid, week] of Object.entries(event.teams)) {
      const id = Number(tid);
      const scored = scoreGolfWeek(
        week,
        tweaks,
        event.officialMultiplier,
        event.multiplierTier,
      );
      weekTotals.set(id, {
        official: week.officialTotal,
        sim: scored.total,
        captain: scored.captainWeek,
      });
      const acc = totals.get(id) ?? { official: 0, simulated: 0 };
      acc.simulated += scored.total;
      totals.set(id, acc);
    }
    for (const pair of event.pairings) {
      const home = weekTotals.get(pair.homeId);
      const away = weekTotals.get(pair.awayId);
      if (!home || !away) continue;
      let simulatedOutcome = outcomeFromScores(home.sim, away.sim);
      if (simulatedOutcome === "T" && golf.captainTiebreaker) {
        if (home.captain > away.captain) simulatedOutcome = "W";
        else if (home.captain < away.captain) simulatedOutcome = "L";
      }
      matchups.push({
        eventId: event.eventId,
        homeId: pair.homeId,
        awayId: pair.awayId,
        officialOutcome: pair.officialOutcome,
        simulatedOutcome,
        flipped: flipLabel(
          pair.officialOutcome === "W" ||
            pair.officialOutcome === "L" ||
            pair.officialOutcome === "T"
            ? pair.officialOutcome
            : "U",
          simulatedOutcome,
        ),
      });
    }
  }

  const rows: GolfSimTeam[] = model.teams.map((team) => {
    const acc = totals.get(team.teamId) ?? { official: 0, simulated: 0 };
    return {
      teamId: team.teamId,
      name: team.name,
      official: acc.official,
      simulated: acc.simulated,
      delta: acc.simulated - acc.official,
      officialRank: team.officialStanding,
      simulatedRank: 0,
    };
  });
  const ranks = rankBy(rows.map((r) => ({ teamId: r.teamId, value: r.simulated })));
  for (const row of rows) {
    row.simulatedRank = ranks.get(row.teamId) ?? rows.length;
  }
  return {
    teams: rows.sort((a, b) => a.simulatedRank - b.simulatedRank),
    matchups,
  };
}

export function formatDelta(value: number, digits = 1): string {
  const abs = Math.abs(value);
  const shown = abs < 0.05 && value !== 0 ? value.toFixed(2) : value.toFixed(digits);
  if (value > 0) return `+${shown}`;
  return shown;
}

export function outcomeArrow(
  official: string,
  simulated: string,
): string {
  if (official === simulated) return official;
  return `${official} → ${simulated}`;
}

export function sandboxTeamName(
  teams: SandboxTeam[],
  id: number,
): string {
  return teams.find((t) => t.teamId === id)?.name ?? `Team ${id}`;
}
