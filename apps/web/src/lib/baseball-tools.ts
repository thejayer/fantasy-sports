/**
 * Projection-free baseball decision helpers (roadmap 8.2).
 * Season-to-date arithmetic over synced ``season_stats`` — no MLB model / ffa.
 */

import type { LeagueSnapshot, Player, SeasonStats, Team } from "@/lib/data";
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
    promise: "Team and pitcher IP vs a disclosed season ceiling.",
    ready: true,
  },
  {
    id: "trailing",
    name: "Hot Streaks",
    promise: "PR7 / PR15 / PR30 trailing windows for waiver scouting.",
    ready: false,
  },
  {
    id: "schedule",
    name: "Week Forecaster",
    promise: "Games per team this period and two-start pitchers.",
    ready: false,
  },
  {
    id: "locks",
    name: "Daily Locks",
    promise: "Lineup lock times for today's MLB slate.",
    ready: false,
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

export type IpUsageBoard = {
  seasonMax: number;
  seasonMaxSource: "settings" | "default";
  teams: TeamIpRow[];
  pitchers: PitcherIpRow[];
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
  categories: CategoryDef[] = DEFAULT_BASEBALL_CATEGORIES,
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
      "Season-to-date from synced roster counting stats (standard 5×5). Rate stats recompute from team totals (AVG = H/AB; ERA/WHIP from pitcher ERA×IP and WHIP×IP). Not ESPN period category boxes and not an MLB projection model.",
  };
}

export function resolveSeasonIpMax(league: LeagueSnapshot): {
  max: number;
  source: "settings" | "default";
} {
  const raw = (league.settings as { season_ip_max?: number } | null)
    ?.season_ip_max;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return { max: raw, source: "settings" };
  }
  return { max: DEFAULT_SEASON_IP_MAX, source: "default" };
}

export function buildIpUsageBoard(league: LeagueSnapshot): IpUsageBoard {
  const { max: seasonMax, source } = resolveSeasonIpMax(league);
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

  return {
    seasonMax,
    seasonMaxSource: source,
    teams,
    pitchers: pitchers.slice(0, 25),
    disclaimer:
      source === "default"
        ? `Season IP ceiling defaults to ${seasonMax} (not synced from ESPN). Minimum weekly IP forfeits need period box scores — not available yet.`
        : "Season IP ceiling from league settings. Minimum weekly IP forfeits need period box scores — not available yet.",
  };
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
