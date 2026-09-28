/**
 * Projection-free baseball decision helpers (roadmap 8.2).
 * Season-to-date arithmetic over synced ``season_stats`` — no MLB model / ffa.
 */

import type {
  LeagueSnapshot,
  Player,
  ProScheduleGame,
  ProScheduleSnapshot,
  SeasonStats,
  Team,
  WeekBoxScoreSnapshot,
} from "@/lib/data";
import { isPitcher } from "@/lib/baseball";

export type BaseballToolsView =
  | "home"
  | "categories"
  | "usage"
  | "trailing"
  | "schedule"
  | "locks";

/** Proper nouns + one-line promises (mirror football 7.8 packaging). */
export const BASEBALL_TOOL_CARDS: Array<{
  id: Exclude<BaseballToolsView, "home">;
  name: string;
  promise: string;
  /** True when the tool runs on current season snapshots alone. */
  ready: boolean;
}> = [
  {
    id: "categories",
    name: "Category Board",
    promise: "Season-to-date category ranks and margins from counting stats.",
    ready: true,
  },
  {
    id: "usage",
    name: "Usage Caps",
    promise: "Season IP / GS caps plus period IP vs a weekly floor when synced.",
    ready: true,
  },
  {
    id: "trailing",
    name: "Hot Streaks",
    promise: "PR7 / PR15 / PR30 trailing windows for waiver scouting.",
    ready: true,
  },
  {
    id: "schedule",
    name: "Week Forecaster",
    promise: "Games per team this period and two-start pitchers.",
    ready: true,
  },
  {
    id: "locks",
    name: "Daily Locks",
    promise: "Lineup lock times for today's MLB slate.",
    ready: true,
  },
];

export type CategoryId =
  | "R"
  | "HR"
  | "RBI"
  | "SB"
  | "AVG"
  | "W"
  | "SV"
  | "K"
  | "ERA"
  | "WHIP";

export type CategoryDef = {
  id: CategoryId;
  label: string;
  /** Counting sum vs rate recomputed from roster totals. */
  kind: "count" | "rate";
  higherIsBetter: boolean;
  digits: number;
};

/** Standard 5×5 when league category lists are not synced. */
export const DEFAULT_BASEBALL_CATEGORIES: CategoryDef[] = [
  { id: "R", label: "R", kind: "count", higherIsBetter: true, digits: 0 },
  { id: "HR", label: "HR", kind: "count", higherIsBetter: true, digits: 0 },
  { id: "RBI", label: "RBI", kind: "count", higherIsBetter: true, digits: 0 },
  { id: "SB", label: "SB", kind: "count", higherIsBetter: true, digits: 0 },
  { id: "AVG", label: "AVG", kind: "rate", higherIsBetter: true, digits: 3 },
  { id: "W", label: "W", kind: "count", higherIsBetter: true, digits: 0 },
  { id: "SV", label: "SV", kind: "count", higherIsBetter: true, digits: 0 },
  { id: "K", label: "K", kind: "count", higherIsBetter: true, digits: 0 },
  { id: "ERA", label: "ERA", kind: "rate", higherIsBetter: false, digits: 2 },
  { id: "WHIP", label: "WHIP", kind: "rate", higherIsBetter: false, digits: 2 },
];

/** Default season team IP ceiling when settings omit one (disclosed in UI). */
export const DEFAULT_SEASON_IP_MAX = 1400;

/** Default Yahoo-style weekly IP floor when period lines exist but settings omit one. */
export const DEFAULT_MIN_WEEKLY_IP = 20;

export type TeamCountingTotals = {
  teamId: number;
  name: string;
  ab: number;
  h: number;
  r: number;
  hr: number;
  rbi: number;
  sb: number;
  w: number;
  sv: number;
  k: number;
  /** Sum of outs (3 outs = 1 IP). */
  outs: number;
  /** Derived earned runs from per-pitcher ERA × IP / 9. */
  er: number;
  /** Derived walks+hits from per-pitcher WHIP × IP. */
  wh: number;
};

export type CategoryCell = {
  value: number | null;
  rank: number | null;
  /** Distance to the next-better team in this category (signed display). */
  marginToLeader: number | null;
};

export type CategoryTeamRow = {
  teamId: number;
  name: string;
  cells: Record<CategoryId, CategoryCell>;
  /** Roto-style points: best = N teams, worst = 1 (ties share average). */
  rotoPoints: number;
  rotoRank: number;
};

export type CategoryBoard = {
  categories: CategoryDef[];
  rows: CategoryTeamRow[];
  disclaimer: string;
};

export type PitcherIpRow = {
  playerId: number | string | null;
  name: string;
  ip: number;
  teamId: number;
  teamName: string;
};

export type TeamIpRow = {
  teamId: number;
  name: string;
  ip: number;
  seasonMax: number;
  remaining: number;
  pct: number;
};

export type TeamGsRow = {
  teamId: number;
  name: string;
  gs: number;
  seasonMax: number;
  remaining: number;
  pct: number;
};

export type PeriodTeamIpRow = {
  teamId: number;
  name: string;
  ip: number;
  minWeeklyIp: number;
  remaining: number;
  met: boolean;
};

export type IpUsageBoard = {
  seasonMax: number;
  seasonMaxSource: "settings" | "default";
  teams: TeamIpRow[];
  pitchers: PitcherIpRow[];
  seasonGsMax: number | null;
  seasonGsSource: "settings" | null;
  gsTeams: TeamGsRow[];
  period: number | null;
  minWeeklyIp: number | null;
  minWeeklyIpSource: "settings" | "default" | null;
  periodTeams: PeriodTeamIpRow[];
  disclaimer: string;
};

export type TwoStartPitcherRow = {
  playerId: number | string | null;
  name: string;
  starts: number;
  fantasyTeamId: number | null;
  fantasyTeamName: string;
  games: Array<{
    startTime: string;
    awayProTeam: string;
    homeProTeam: string;
    side: "home" | "away";
  }>;
};

export type TwoStartBoard = {
  period: number | null;
  scoringPeriods: number[];
  rows: TwoStartPitcherRow[];
  disclaimer: string;
};

export type TrailingWindow = "7" | "15" | "30";

export type TrailingPlayerRow = {
  playerId: number | string | null;
  name: string;
  role: "batter" | "pitcher";
  position: string | null;
  proTeam: string | null;
  fantasyTeamId: number | null;
  fantasyTeamName: string;
  status: "rostered" | "free_agent";
  stats: SeasonStats;
  score: number;
};

export type TrailingBoard = {
  window: TrailingWindow;
  batters: TrailingPlayerRow[];
  pitchers: TrailingPlayerRow[];
  disclaimer: string;
};

export type GamesPerTeamRow = {
  teamId: number;
  name: string;
  totalPlayerGames: number;
  proTeamGames: Array<{ proTeam: string; games: number; players: number }>;
};

export type GamesPerTeamBoard = {
  period: number | null;
  scoringPeriods: number[];
  rows: GamesPerTeamRow[];
  games: ProScheduleGame[];
  disclaimer: string;
};

export type DailyLockPlayer = {
  playerId: number | string | null;
  name: string;
  teamId: number;
  teamName: string;
  slot: string | null;
  proTeam: string;
};

export type DailyLockGame = {
  startTime: string;
  awayProTeam: string;
  homeProTeam: string;
  players: DailyLockPlayer[];
};

export type DailyLocksBoard = {
  date: string;
  games: DailyLockGame[];
  disclaimer: string;
};

function num(stats: SeasonStats | undefined, key: keyof SeasonStats): number {
  const v = stats?.[key];
  return typeof v === "number" && !Number.isNaN(v) ? v : 0;
}

function playerIp(stats: SeasonStats | undefined): number {
  const ip = num(stats, "IP");
  if (ip > 0) return ip;
  const outs = num(stats, "OUTS");
  return outs > 0 ? outs / 3 : 0;
}

/** Aggregate counting denominators across a roster for rate recompute. */
export function aggregateTeamCounting(team: Team): TeamCountingTotals {
  const totals: TeamCountingTotals = {
    teamId: team.team_id,
    name: team.name,
    ab: 0,
    h: 0,
    r: 0,
    hr: 0,
    rbi: 0,
    sb: 0,
    w: 0,
    sv: 0,
    k: 0,
    outs: 0,
    er: 0,
    wh: 0,
  };
  for (const p of team.roster ?? []) {
    const s = p.season_stats;
    if (!s) continue;
    if (!isPitcher(p)) {
      totals.ab += num(s, "AB");
      totals.h += num(s, "H");
      totals.r += num(s, "R");
      totals.hr += num(s, "HR");
      totals.rbi += num(s, "RBI");
      totals.sb += num(s, "SB");
    } else {
      totals.w += num(s, "W");
      totals.sv += num(s, "SV");
      totals.k += num(s, "K");
      const ip = playerIp(s);
      const outs = num(s, "OUTS") || ip * 3;
      totals.outs += outs;
      const era = num(s, "ERA");
      const whip = num(s, "WHIP");
      if (ip > 0 && era > 0) totals.er += (era * ip) / 9;
      if (ip > 0 && whip > 0) totals.wh += whip * ip;
    }
  }
  return totals;
}

export function categoryValue(
  totals: TeamCountingTotals,
  cat: CategoryDef,
): number | null {
  switch (cat.id) {
    case "R":
      return totals.r;
    case "HR":
      return totals.hr;
    case "RBI":
      return totals.rbi;
    case "SB":
      return totals.sb;
    case "AVG":
      return totals.ab > 0 ? totals.h / totals.ab : null;
    case "W":
      return totals.w;
    case "SV":
      return totals.sv;
    case "K":
      return totals.k;
    case "ERA": {
      const ip = totals.outs / 3;
      return ip > 0 ? (totals.er * 9) / ip : null;
    }
    case "WHIP": {
      const ip = totals.outs / 3;
      return ip > 0 ? totals.wh / ip : null;
    }
    default:
      return null;
  }
}

function categoryDefByAbbr(): Map<string, CategoryDef> {
  return new Map(DEFAULT_BASEBALL_CATEGORIES.map((cat) => [cat.id, cat]));
}

export function baseballCategoriesForLeague(league: LeagueSnapshot): CategoryDef[] {
  const synced = league.settings?.categories;
  if (!synced?.length) return DEFAULT_BASEBALL_CATEGORIES;

  const defaults = categoryDefByAbbr();
  const categories: CategoryDef[] = [];
  for (const row of synced) {
    const abbr = row.abbr?.trim().toUpperCase();
    if (!abbr) continue;
    const base = defaults.get(abbr);
    if (!base) continue;
    categories.push({
      ...base,
      label: row.label?.trim() || base.label,
    });
  }
  return categories.length ? categories : DEFAULT_BASEBALL_CATEGORIES;
}

function rankValues(
  values: Array<{ teamId: number; value: number | null }>,
  higherIsBetter: boolean,
): Map<number, number> {
  const scored = values.filter(
    (v): v is { teamId: number; value: number } => v.value != null,
  );
  scored.sort((a, b) =>
    higherIsBetter ? b.value - a.value : a.value - b.value,
  );
  const ranks = new Map<number, number>();
  let i = 0;
  while (i < scored.length) {
    let j = i;
    while (j < scored.length && scored[j]!.value === scored[i]!.value) j += 1;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k += 1) ranks.set(scored[k]!.teamId, avgRank);
    i = j;
  }
  return ranks;
}

/**
 * Season-to-date category board from roster ``season_stats``.
 * Not ESPN period box scores and not a projection model.
 */
export function buildCategoryBoard(
  league: LeagueSnapshot,
  categories: CategoryDef[] = baseballCategoriesForLeague(league),
): CategoryBoard {
  const totals = league.teams.map(aggregateTeamCounting);
  const n = Math.max(totals.length, 1);
  const valueByCat = new Map<CategoryId, Map<number, number | null>>();
  const rankByCat = new Map<CategoryId, Map<number, number>>();

  for (const cat of categories) {
    const values = totals.map((t) => ({
      teamId: t.teamId,
      value: categoryValue(t, cat),
    }));
    valueByCat.set(
      cat.id,
      new Map(values.map((v) => [v.teamId, v.value])),
    );
    rankByCat.set(cat.id, rankValues(values, cat.higherIsBetter));
  }

  const rows: CategoryTeamRow[] = totals.map((t) => {
    const cells = {} as Record<CategoryId, CategoryCell>;
    let rotoPoints = 0;
    let scoredCats = 0;
    for (const cat of categories) {
      const value = valueByCat.get(cat.id)?.get(t.teamId) ?? null;
      const rank = rankByCat.get(cat.id)?.get(t.teamId) ?? null;
      let marginToLeader: number | null = null;
      if (value != null) {
        const peers = totals
          .map((o) => valueByCat.get(cat.id)?.get(o.teamId) ?? null)
          .filter((v): v is number => v != null);
        if (peers.length) {
          const leader = cat.higherIsBetter
            ? Math.max(...peers)
            : Math.min(...peers);
          marginToLeader = value - leader;
        }
      }
      cells[cat.id] = { value, rank, marginToLeader };
      if (rank != null) {
        rotoPoints += n - rank + 1;
        scoredCats += 1;
      }
    }
    return {
      teamId: t.teamId,
      name: t.name,
      cells,
      rotoPoints: scoredCats ? rotoPoints : 0,
      rotoRank: 0,
    };
  });

  const rotoRanks = rankValues(
    rows.map((r) => ({ teamId: r.teamId, value: r.rotoPoints })),
    true,
  );
  for (const row of rows) {
    row.rotoRank = rotoRanks.get(row.teamId) ?? rows.length;
  }
  rows.sort(
    (a, b) =>
      b.rotoPoints - a.rotoPoints || a.name.localeCompare(b.name),
  );

  return {
    categories,
    rows,
    disclaimer:
      "Season-to-date from synced roster counting stats. Rate stats recompute from team totals (AVG = H/AB; ERA/WHIP from pitcher ERA×IP and WHIP×IP). Not ESPN period category boxes and not an MLB projection model.",
  };
}

export function resolveSeasonIpMax(league: LeagueSnapshot): {
  max: number;
  source: "settings" | "default";
} {
  const raw = league.settings?.season_ip_max;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return { max: raw, source: "settings" };
  }
  return { max: DEFAULT_SEASON_IP_MAX, source: "default" };
}

export function resolveSeasonGsMax(league: LeagueSnapshot): {
  max: number | null;
  source: "settings" | null;
} {
  const raw = league.settings?.season_gs_max;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return { max: raw, source: "settings" };
  }
  const limits = league.settings?.lineup_slot_stat_limits ?? [];
  const gs = limits.filter((row) => row.stat === "GS" && row.limit > 0);
  const p = gs.find((row) => row.slot === "P");
  if (p) return { max: p.limit, source: "settings" };
  const alt = gs
    .filter((row) => row.slot === "SP" || row.slot === "RP")
    .map((row) => row.limit);
  if (alt.length) return { max: Math.max(...alt), source: "settings" };
  return { max: null, source: null };
}

export function resolveMinWeeklyIp(
  league: LeagueSnapshot,
  hasPeriodIp: boolean,
): { max: number | null; source: "settings" | "default" | null } {
  if (!hasPeriodIp) return { max: null, source: null };
  const raw = league.settings?.min_weekly_ip;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return { max: raw, source: "settings" };
  }
  return { max: DEFAULT_MIN_WEEKLY_IP, source: "default" };
}

function playerGs(stats: SeasonStats | undefined): number {
  return num(stats, "GS");
}

export function buildIpUsageBoard(
  league: LeagueSnapshot,
  weekBox: WeekBoxScoreSnapshot | null | undefined = null,
): IpUsageBoard {
  const { max: seasonMax, source } = resolveSeasonIpMax(league);
  const { max: seasonGsMax, source: gsSource } = resolveSeasonGsMax(league);
  const teams: TeamIpRow[] = league.teams.map((team) => {
    const ip = (team.roster ?? []).reduce((sum, p) => {
      if (!isPitcher(p)) return sum;
      return sum + playerIp(p.season_stats);
    }, 0);
    const remaining = seasonMax - ip;
    return {
      teamId: team.team_id,
      name: team.name,
      ip,
      seasonMax,
      remaining,
      pct: seasonMax > 0 ? ip / seasonMax : 0,
    };
  });
  teams.sort((a, b) => b.ip - a.ip || a.name.localeCompare(b.name));

  const pitchers: PitcherIpRow[] = [];
  for (const team of league.teams) {
    for (const p of team.roster ?? []) {
      if (!isPitcher(p)) continue;
      const ip = playerIp(p.season_stats);
      if (ip <= 0) continue;
      pitchers.push({
        playerId: p.id,
        name: p.name ?? `Player ${p.id}`,
        ip,
        teamId: team.team_id,
        teamName: team.name,
      });
    }
  }
  pitchers.sort((a, b) => b.ip - a.ip || a.name.localeCompare(b.name));

  const gsTeams: TeamGsRow[] = [];
  if (seasonGsMax != null) {
    for (const team of league.teams) {
      const gs = (team.roster ?? []).reduce((sum, p) => {
        if (!isPitcher(p)) return sum;
        return sum + playerGs(p.season_stats);
      }, 0);
      gsTeams.push({
        teamId: team.team_id,
        name: team.name,
        gs,
        seasonMax: seasonGsMax,
        remaining: seasonGsMax - gs,
        pct: seasonGsMax > 0 ? gs / seasonGsMax : 0,
      });
    }
    gsTeams.sort((a, b) => b.gs - a.gs || a.name.localeCompare(b.name));
  }

  const periodIpRows =
    weekBox?.sport === "baseball" && Array.isArray(weekBox.pitcher_ip)
      ? weekBox.pitcher_ip
      : [];
  const { max: minWeeklyIp, source: minSource } = resolveMinWeeklyIp(
    league,
    periodIpRows.length > 0,
  );
  const teamNameById = new Map(
    league.teams.map((team) => [team.team_id, team.name]),
  );
  const periodByTeam = new Map<number, number>();
  for (const row of periodIpRows) {
    if (row.team_id == null) continue;
    const ip =
      typeof row.ip === "number" && Number.isFinite(row.ip)
        ? row.ip
        : typeof row.outs === "number"
          ? row.outs / 3
          : 0;
    periodByTeam.set(row.team_id, (periodByTeam.get(row.team_id) ?? 0) + ip);
  }
  const periodTeams: PeriodTeamIpRow[] = [];
  if (minWeeklyIp != null) {
    for (const team of league.teams) {
      const ip = periodByTeam.get(team.team_id) ?? 0;
      periodTeams.push({
        teamId: team.team_id,
        name: teamNameById.get(team.team_id) ?? team.name,
        ip,
        minWeeklyIp,
        remaining: minWeeklyIp - ip,
        met: ip + 1e-9 >= minWeeklyIp,
      });
    }
    periodTeams.sort((a, b) => a.ip - b.ip || a.name.localeCompare(b.name));
  }

  const bits: string[] = [];
  bits.push(
    source === "default"
      ? `Season IP ceiling defaults to ${seasonMax} (not synced from ESPN).`
      : "Season IP ceiling from league settings.",
  );
  if (seasonGsMax != null) {
    bits.push(
      `Season GS ceiling ${seasonGsMax} from ESPN lineup slot stat limits.`,
    );
  } else {
    bits.push("No season GS cap synced from ESPN roster settings.");
  }
  if (periodIpRows.length && minWeeklyIp != null) {
    bits.push(
      minSource === "default"
        ? `Period pitcher IP from weeks/${weekBox?.week}.json; weekly floor defaults to ${minWeeklyIp} (Yahoo-style — not an ESPN setting).`
        : `Period pitcher IP from weeks/${weekBox?.week}.json vs settings min weekly IP ${minWeeklyIp}.`,
    );
  } else {
    bits.push(
      "Minimum weekly IP forfeits need period pitcher lines on weeks/{N}.json — absent for this snapshot.",
    );
  }

  return {
    seasonMax,
    seasonMaxSource: source,
    teams,
    pitchers: pitchers.slice(0, 25),
    seasonGsMax,
    seasonGsSource: gsSource,
    gsTeams,
    period: weekBox?.week ?? league.current_week ?? null,
    minWeeklyIp,
    minWeeklyIpSource: minSource,
    periodTeams,
    disclaimer: bits.join(" "),
  };
}

function hasCountingStats(stats: SeasonStats | undefined, keys: Array<keyof SeasonStats>) {
  return keys.some((key) => num(stats, key) > 0);
}

function batterTrailingScore(stats: SeasonStats): number {
  return (
    num(stats, "R") +
    num(stats, "HR") +
    num(stats, "RBI") +
    num(stats, "SB")
  );
}

function pitcherTrailingScore(stats: SeasonStats): number {
  return (
    num(stats, "K") +
    num(stats, "W") +
    num(stats, "SV") +
    num(stats, "HLD") +
    num(stats, "QS")
  );
}

function allRosterPlayers(league: LeagueSnapshot): Array<{
  player: Player;
  teamId: number;
  teamName: string;
}> {
  const rows: Array<{ player: Player; teamId: number; teamName: string }> = [];
  for (const team of league.teams) {
    for (const player of team.roster ?? []) {
      rows.push({ player, teamId: team.team_id, teamName: team.name });
    }
  }
  return rows;
}

export function buildTrailingBoard(
  league: LeagueSnapshot,
  window: TrailingWindow,
): TrailingBoard {
  const batters: TrailingPlayerRow[] = [];
  const pitchers: TrailingPlayerRow[] = [];
  const rosterRows = allRosterPlayers(league);
  const freeAgentRows = (league.free_agents ?? []).map((player) => ({
    player,
    teamId: null,
    teamName: "Free agent",
  }));

  for (const row of [...rosterRows, ...freeAgentRows]) {
    const stats = row.player.trailing_stats?.[window];
    if (!stats) continue;
    const pitcher = isPitcher(row.player);
    const keys: Array<keyof SeasonStats> = pitcher
      ? ["K", "W", "SV", "HLD", "QS"]
      : ["R", "HR", "RBI", "SB"];
    if (!hasCountingStats(stats, keys)) continue;
    const item: TrailingPlayerRow = {
      playerId: row.player.id,
      name: row.player.name ?? `Player ${row.player.id}`,
      role: pitcher ? "pitcher" : "batter",
      position: row.player.position,
      proTeam: row.player.pro_team,
      fantasyTeamId: row.teamId,
      fantasyTeamName: row.teamName,
      status: row.teamId == null ? "free_agent" : "rostered",
      stats,
      score: pitcher ? pitcherTrailingScore(stats) : batterTrailingScore(stats),
    };
    if (pitcher) pitchers.push(item);
    else batters.push(item);
  }

  const byScoreThenName = (a: TrailingPlayerRow, b: TrailingPlayerRow) =>
    b.score - a.score || a.name.localeCompare(b.name);
  batters.sort(byScoreThenName);
  pitchers.sort(byScoreThenName);

  return {
    window,
    batters: batters.slice(0, 25),
    pitchers: pitchers.slice(0, 25),
    disclaimer:
      batters.length || pitchers.length
        ? `ESPN PR${window} trailing split from roster and free-agent rows. Scores are simple counting-stat sums, not projections.`
        : `No ESPN PR${window} trailing split is present; this snapshot may only have the season bucket.`,
  };
}

function normalizedTeam(value: string | null | undefined): string | null {
  const team = value?.trim().toUpperCase();
  return team || null;
}

function periodsForSchedule(
  schedule: ProScheduleSnapshot | null | undefined,
  league: LeagueSnapshot,
  period?: number | null,
): { period: number | null; scoringPeriods: number[] } {
  const selected =
    period != null && Number.isFinite(period) ? Math.trunc(period) : league.current_week;
  if (selected == null) return { period: null, scoringPeriods: [] };
  const raw =
    schedule?.matchup_periods?.[String(selected)] ??
    league.settings?.matchup_periods?.[String(selected)];
  const scoringPeriods = (raw?.length ? raw : [selected]).filter((value) =>
    Number.isFinite(value),
  );
  return { period: selected, scoringPeriods };
}

function gameTeams(game: ProScheduleGame): string[] {
  return [normalizedTeam(game.away_pro_team), normalizedTeam(game.home_pro_team)].filter(
    (team): team is string => Boolean(team),
  );
}

export function buildGamesPerTeamBoard(
  league: LeagueSnapshot,
  schedule: ProScheduleSnapshot | null | undefined,
  period?: number | null,
): GamesPerTeamBoard {
  const { period: selectedPeriod, scoringPeriods } = periodsForSchedule(
    schedule,
    league,
    period,
  );
  const periodSet = new Set(scoringPeriods);
  const games = (schedule?.games ?? []).filter(
    (game) => game.scoring_period_id != null && periodSet.has(game.scoring_period_id),
  );
  const gamesByProTeam = new Map<string, number>();
  for (const game of games) {
    for (const proTeam of gameTeams(game)) {
      gamesByProTeam.set(proTeam, (gamesByProTeam.get(proTeam) ?? 0) + 1);
    }
  }

  const rows: GamesPerTeamRow[] = league.teams.map((team) => {
    const playersByProTeam = new Map<string, number>();
    for (const player of team.roster ?? []) {
      const proTeam = normalizedTeam(player.pro_team);
      if (!proTeam) continue;
      playersByProTeam.set(proTeam, (playersByProTeam.get(proTeam) ?? 0) + 1);
    }
    const proTeamGames = [...playersByProTeam.entries()]
      .map(([proTeam, players]) => ({
        proTeam,
        players,
        games: gamesByProTeam.get(proTeam) ?? 0,
      }))
      .sort((a, b) => b.games - a.games || a.proTeam.localeCompare(b.proTeam));
    return {
      teamId: team.team_id,
      name: team.name,
      totalPlayerGames: proTeamGames.reduce(
        (sum, row) => sum + row.games * row.players,
        0,
      ),
      proTeamGames,
    };
  });
  rows.sort(
    (a, b) => b.totalPlayerGames - a.totalPlayerGames || a.name.localeCompare(b.name),
  );

  return {
    period: selectedPeriod,
    scoringPeriods,
    rows,
    games,
    disclaimer:
      "Counts roster player-games from MLB teams scheduled in the selected ESPN matchup period. Two-start pitchers use probable starters on the same slate.",
  };
}

function playerIdKey(id: number | string | null | undefined): string | null {
  if (id == null || id === "") return null;
  return String(id);
}

/**
 * Pitchers listed as probable starter in 2+ period games (roadmap 8.2 leftover).
 */
export function buildTwoStartBoard(
  league: LeagueSnapshot,
  schedule: ProScheduleSnapshot | null | undefined,
  period?: number | null,
): TwoStartBoard {
  const { period: selectedPeriod, scoringPeriods } = periodsForSchedule(
    schedule,
    league,
    period,
  );
  const periodSet = new Set(scoringPeriods);
  const games = (schedule?.games ?? []).filter(
    (game) => game.scoring_period_id != null && periodSet.has(game.scoring_period_id),
  );

  const rosterById = new Map<
    string,
    { name: string; teamId: number; teamName: string }
  >();
  for (const team of league.teams) {
    for (const player of team.roster ?? []) {
      const key = playerIdKey(player.id);
      if (!key) continue;
      rosterById.set(key, {
        name: player.name ?? `Player ${player.id}`,
        teamId: team.team_id,
        teamName: team.name,
      });
    }
  }

  type Acc = {
    playerId: number | string | null;
    name: string;
    fantasyTeamId: number | null;
    fantasyTeamName: string;
    games: TwoStartPitcherRow["games"];
  };
  const byPitcher = new Map<string, Acc>();

  const touch = (
    probable: ProScheduleGame["probable_home"],
    game: ProScheduleGame,
    side: "home" | "away",
  ) => {
    if (!probable?.name && probable?.id == null) return;
    const key = playerIdKey(probable.id) ?? `name:${probable.name}`;
    const roster = probable.id != null ? rosterById.get(String(probable.id)) : undefined;
    const existing = byPitcher.get(key);
    const gameRow = {
      startTime: game.start_time,
      awayProTeam: normalizedTeam(game.away_pro_team) ?? "?",
      homeProTeam: normalizedTeam(game.home_pro_team) ?? "?",
      side,
    };
    if (existing) {
      existing.games.push(gameRow);
      return;
    }
    byPitcher.set(key, {
      playerId: probable.id ?? null,
      name: roster?.name ?? probable.name ?? `Player ${probable.id}`,
      fantasyTeamId: roster?.teamId ?? null,
      fantasyTeamName: roster?.teamName ?? "Free agent / unrostered",
      games: [gameRow],
    });
  };

  for (const game of games) {
    touch(game.probable_home, game, "home");
    touch(game.probable_away, game, "away");
  }

  const rows: TwoStartPitcherRow[] = [...byPitcher.values()]
    .filter((row) => row.games.length >= 2)
    .map((row) => ({
      playerId: row.playerId,
      name: row.name,
      starts: row.games.length,
      fantasyTeamId: row.fantasyTeamId,
      fantasyTeamName: row.fantasyTeamName,
      games: row.games.sort((a, b) => a.startTime.localeCompare(b.startTime)),
    }))
    .sort(
      (a, b) =>
        b.starts - a.starts ||
        a.fantasyTeamName.localeCompare(b.fantasyTeamName) ||
        a.name.localeCompare(b.name),
    );

  const hasProbables = games.some(
    (game) => game.probable_home?.name || game.probable_away?.name,
  );

  return {
    period: selectedPeriod,
    scoringPeriods,
    rows,
    disclaimer: hasProbables
      ? rows.length
        ? "Two-start pitchers from ESPN site probable starters matched to this period's pro_schedule games. Fantasy team is the current roster owner when the ESPN player id resolves."
        : "Probable starters are present on the slate, but no pitcher is listed for two or more starts in this period."
      : "No probable starters on pro_schedule.json yet — sync enriches from the ESPN MLB site scoreboard.",
  };
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const BASEBALL_FIXTURE_NOW = "2026-07-27T12:00:00+00:00";

export function baseballFixtureNow(syncedAt: string | null | undefined): Date {
  if (syncedAt?.startsWith("2026-07-27")) {
    return new Date(BASEBALL_FIXTURE_NOW);
  }
  return new Date();
}

export function buildDailyLocksBoard(
  league: LeagueSnapshot,
  schedule: ProScheduleSnapshot | null | undefined,
  now: Date,
): DailyLocksBoard {
  const target = utcDateKey(now);
  const playersByProTeam = new Map<string, DailyLockPlayer[]>();
  for (const team of league.teams) {
    for (const player of team.roster ?? []) {
      const proTeam = normalizedTeam(player.pro_team);
      if (!proTeam) continue;
      const row: DailyLockPlayer = {
        playerId: player.id,
        name: player.name ?? `Player ${player.id}`,
        teamId: team.team_id,
        teamName: team.name,
        slot: player.slot,
        proTeam,
      };
      playersByProTeam.set(proTeam, [...(playersByProTeam.get(proTeam) ?? []), row]);
    }
  }

  const games: DailyLockGame[] = [];
  for (const game of schedule?.games ?? []) {
    const start = new Date(game.start_time);
    if (Number.isNaN(start.getTime()) || utcDateKey(start) !== target) continue;
    const awayProTeam = normalizedTeam(game.away_pro_team);
    const homeProTeam = normalizedTeam(game.home_pro_team);
    if (!awayProTeam || !homeProTeam) continue;
    const players = [
      ...(playersByProTeam.get(awayProTeam) ?? []),
      ...(playersByProTeam.get(homeProTeam) ?? []),
    ].sort((a, b) => a.teamName.localeCompare(b.teamName) || a.name.localeCompare(b.name));
    games.push({
      startTime: game.start_time,
      awayProTeam,
      homeProTeam,
      players,
    });
  }
  games.sort((a, b) => a.startTime.localeCompare(b.startTime));

  return {
    date: target,
    games,
    disclaimer:
      "Lineups lock at each MLB game start time shown in UTC. Players list only current fantasy rosters with matching pro teams.",
  };
}

export function parseTrailingWindow(
  raw: string | undefined | null,
): TrailingWindow {
  return raw === "15" || raw === "30" ? raw : "7";
}

export function parseBaseballToolsView(
  raw: string | undefined | null,
): BaseballToolsView {
  const v = raw ?? "home";
  if (
    v === "home" ||
    v === "categories" ||
    v === "usage" ||
    v === "trailing" ||
    v === "schedule" ||
    v === "locks"
  ) {
    return v;
  }
  return "home";
}

/** @internal test helper — expose pitcher IP parse. */
export function pitcherIpForTests(player: Player): number {
  return playerIp(player.season_stats);
}
