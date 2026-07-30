/**
 * Hub-side playoff make-% Monte Carlo for trade Δ (roadmap 7.8).
 *
 * Mirrors `ffa.playoff_export.simulate_playoff_odds` over an offline samples
 * sidecar (`{season}.samples.json`). Next handlers never invoke `ffa`.
 */

import type { LeagueSnapshot, Team } from "@/lib/data";

const SKILL_POS = new Set(["QB", "RB", "WR", "TE"]);

export type PlayoffOddsSamples = {
  schema_version: number;
  generated_at: string;
  league_id: string;
  season: number;
  scoring: string;
  n_sims_default: number;
  n_samples: number;
  seed: number;
  points_by_espn: Record<string, number[]>;
};

export type PlayoffSimTeamRow = {
  team_id: number;
  make_playoffs: number;
  avg_wins: number;
  mapped_roster: number;
  rostered: number;
};

export type PlayoffSimResult = {
  periods_simulated: number[];
  n_matchups: number;
  playoff_team_count: number;
  teams: PlayoffSimTeamRow[];
};

export function rosterSlotsFromSettings(
  settings: LeagueSnapshot["settings"] | null | undefined,
): Record<string, number> {
  const raw =
    (settings as { position_slot_counts?: Record<string, number> } | null)
      ?.position_slot_counts ?? {};
  return {
    QB: Number(raw.QB ?? 1),
    RB: Number(raw.RB ?? 2),
    WR: Number(raw.WR ?? 2),
    TE: Number(raw.TE ?? 1),
    FLEX: Number(raw.FLEX ?? 1),
  };
}

export function greedyLineupPoints(
  players: Array<{ id: string; position: string; points: number }>,
  slots: Record<string, number>,
): number {
  const ordered = [...players].sort((a, b) => b.points - a.points);
  const picked = new Set<string>();
  let total = 0;

  function take(n: number, eligible: Set<string>) {
    for (const row of ordered) {
      if (n <= 0) break;
      if (picked.has(row.id) || !eligible.has(row.position)) continue;
      picked.add(row.id);
      total += row.points;
      n -= 1;
    }
  }

  take(slots.QB ?? 0, new Set(["QB"]));
  take(slots.RB ?? 0, new Set(["RB"]));
  take(slots.WR ?? 0, new Set(["WR"]));
  take(slots.TE ?? 0, new Set(["TE"]));
  take(slots.FLEX ?? 0, new Set(["RB", "WR", "TE"]));
  return total;
}

export function undecidedMatchups(
  teams: Team[],
  regSeasonCount: number,
  asOfWeek?: number | null,
): Array<[number, number, number]> {
  const byId = new Map(teams.map((t) => [t.team_id, t]));
  const seen = new Set<string>();
  const out: Array<[number, number, number]> = [];

  for (const team of teams) {
    const tid = team.team_id;
    const schedule = team.schedule ?? [];
    const outcomes = team.outcomes ?? [];
    for (let i = 0; i < schedule.length; i++) {
      const period = i + 1;
      if (period > regSeasonCount) continue;
      const oppId = Number(schedule[i]);
      if (!Number.isFinite(oppId) || oppId === tid) continue;
      const a = tid < oppId ? tid : oppId;
      const b = tid < oppId ? oppId : tid;
      const key = `${period}:${a}:${b}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const force = asOfWeek != null && period >= asOfWeek;
      const leftOut = String(outcomes[i] ?? "U");
      const right = byId.get(oppId);
      const rightOut = String(right?.outcomes?.[i] ?? "U");
      const undecided = ["U", "", "None"].includes(leftOut);
      const rightUndecided = ["U", "", "None"].includes(rightOut);
      if (force || (undecided && rightUndecided)) {
        out.push([period, a, b]);
      }
    }
  }
  out.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  return out;
}

/** Mulberry32 — deterministic PRNG matching seed intent (not numpy). */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

type SkillRow = { espn: string; position: string };

function skillRosters(teams: Team[]): {
  rosterSkill: Map<number, SkillRow[]>;
  mappedCounts: Map<number, [number, number]>;
} {
  const rosterSkill = new Map<number, SkillRow[]>();
  const mappedCounts = new Map<number, [number, number]>();
  for (const team of teams) {
    const rows: SkillRow[] = [];
    let rostered = 0;
    let mapped = 0;
    for (const player of team.roster ?? []) {
      rostered += 1;
      const espn = String(player.id ?? "");
      if (!espn || espn === "None") continue;
      const pos = String(player.position ?? "").toUpperCase();
      if (!SKILL_POS.has(pos)) continue;
      mapped += 1;
      rows.push({ espn, position: pos });
    }
    rosterSkill.set(team.team_id, rows);
    mappedCounts.set(team.team_id, [mapped, rostered]);
  }
  return { rosterSkill, mappedCounts };
}

export function simulatePlayoffOdds(
  league: LeagueSnapshot,
  samples: PlayoffOddsSamples,
  options: {
    nSims?: number;
    seed?: number;
    asOfWeek?: number | null;
  } = {},
): PlayoffSimResult {
  const settings = league.settings ?? {};
  const reg = Number(
    (settings as { reg_season_count?: number }).reg_season_count ?? 14,
  );
  let playoffN = Number(
    (settings as { playoff_team_count?: number }).playoff_team_count ?? 0,
  );
  if (playoffN <= 0) {
    playoffN = Math.max(1, Math.floor(league.teams.length / 2));
  }

  const slots = rosterSlotsFromSettings(settings);
  const matchups = undecidedMatchups(
    league.teams,
    reg,
    options.asOfWeek ?? null,
  );
  const periods = [...new Set(matchups.map(([p]) => p))].sort((a, b) => a - b);
  const { rosterSkill, mappedCounts } = skillRosters(league.teams);
  const points = samples.points_by_espn ?? {};
  let nSamples = 0;
  for (const cols of Object.values(points)) {
    nSamples = Math.max(nSamples, cols.length);
  }
  nSamples = Math.max(nSamples, 1);

  const nSims = Math.max(1, options.nSims ?? samples.n_sims_default ?? 300);
  const rng = mulberry32(options.seed ?? samples.seed ?? 0);

  const make = new Map<number, number>();
  const winSums = new Map<number, number>();
  for (const team of league.teams) {
    make.set(team.team_id, 0);
    winSums.set(team.team_id, 0);
  }

  const baseWins = new Map<number, number>();
  const basePf = new Map<number, number>();
  for (const team of league.teams) {
    baseWins.set(
      team.team_id,
      Number(team.wins ?? 0) + 0.5 * Number(team.ties ?? 0),
    );
    basePf.set(team.team_id, Number(team.points_for ?? 0));
  }

  function teamScore(tid: number, idx: number): number {
    const rows = rosterSkill.get(tid) ?? [];
    const lined: Array<{ id: string; position: string; points: number }> = [];
    for (const row of rows) {
      const arr = points[row.espn];
      if (!arr?.length) continue;
      lined.push({
        id: row.espn,
        position: row.position,
        points: arr[idx % arr.length] ?? 0,
      });
    }
    return greedyLineupPoints(lined, slots);
  }

  for (let sim = 0; sim < nSims; sim++) {
    const wins = new Map(baseWins);
    const pf = new Map(basePf);
    for (const [period, a, b] of matchups) {
      const sampleIdx = Math.floor(rng() * nSamples);
      const sampleB = (sampleIdx + period * 17) % nSamples;
      const sa = teamScore(a, sampleIdx);
      const sb = teamScore(b, sampleB);
      pf.set(a, (pf.get(a) ?? 0) + sa);
      pf.set(b, (pf.get(b) ?? 0) + sb);
      if (sa > sb) wins.set(a, (wins.get(a) ?? 0) + 1);
      else if (sb > sa) wins.set(b, (wins.get(b) ?? 0) + 1);
      else {
        wins.set(a, (wins.get(a) ?? 0) + 0.5);
        wins.set(b, (wins.get(b) ?? 0) + 0.5);
      }
    }

    const ranked = [...league.teams].sort((ta, tb) => {
      const wa = wins.get(ta.team_id) ?? 0;
      const wb = wins.get(tb.team_id) ?? 0;
      if (wb !== wa) return wb - wa;
      const pfa = pf.get(ta.team_id) ?? 0;
      const pfb = pf.get(tb.team_id) ?? 0;
      if (pfb !== pfa) return pfb - pfa;
      return ta.team_id - tb.team_id;
    });
    for (const team of ranked.slice(0, playoffN)) {
      make.set(team.team_id, (make.get(team.team_id) ?? 0) + 1);
    }
    for (const team of league.teams) {
      winSums.set(
        team.team_id,
        (winSums.get(team.team_id) ?? 0) + (wins.get(team.team_id) ?? 0),
      );
    }
  }

  const teams: PlayoffSimTeamRow[] = [...league.teams]
    .sort((a, b) => (a.standing ?? 999) - (b.standing ?? 999))
    .map((team) => {
      const [mapped, rostered] = mappedCounts.get(team.team_id) ?? [0, 0];
      return {
        team_id: team.team_id,
        make_playoffs: (make.get(team.team_id) ?? 0) / nSims,
        avg_wins: (winSums.get(team.team_id) ?? 0) / nSims,
        mapped_roster: mapped,
        rostered,
      };
    });

  return {
    periods_simulated: periods,
    n_matchups: matchups.length,
    playoff_team_count: playoffN,
    teams,
  };
}

/** Apply an ESPN-id roster swap (pure). */
export function applyRosterTrade(
  league: LeagueSnapshot,
  teamA: number,
  teamB: number,
  giveEspnIds: string[],
  getEspnIds: string[],
): LeagueSnapshot {
  const give = new Set(giveEspnIds.map(String));
  const get = new Set(getEspnIds.map(String));
  const teams = league.teams.map((team) => {
    const roster = [...(team.roster ?? [])];
    if (team.team_id === teamA) {
      const keep = roster.filter((p) => !give.has(String(p.id ?? "")));
      const add = (
        league.teams.find((t) => t.team_id === teamB)?.roster ?? []
      ).filter((p) => get.has(String(p.id ?? "")));
      return { ...team, roster: [...keep, ...add] };
    }
    if (team.team_id === teamB) {
      const keep = roster.filter((p) => !get.has(String(p.id ?? "")));
      const add = (
        league.teams.find((t) => t.team_id === teamA)?.roster ?? []
      ).filter((p) => give.has(String(p.id ?? "")));
      return { ...team, roster: [...keep, ...add] };
    }
    return team;
  });
  return { ...league, teams };
}

export type TradePlayoffDelta = {
  available: boolean;
  reason?: string;
  nSims: number;
  periodsSimulated: number[];
  beforeA: number;
  afterA: number;
  deltaA: number;
  beforeB: number;
  afterB: number;
  deltaB: number;
};

/**
 * Price a trade package in Δ make-playoffs for both sides.
 * Returns unavailable when there are no remaining H2H weeks or no samples.
 */
export function tradePlayoffDelta(
  league: LeagueSnapshot,
  samples: PlayoffOddsSamples | null | undefined,
  teamA: number,
  teamB: number,
  giveEspnIds: string[],
  getEspnIds: string[],
  options: { nSims?: number; seed?: number } = {},
): TradePlayoffDelta {
  if (!samples?.points_by_espn || Object.keys(samples.points_by_espn).length === 0) {
    return {
      available: false,
      reason: "No playoff samples sidecar — run ffa export-playoff-odds with --write-samples.",
      nSims: 0,
      periodsSimulated: [],
      beforeA: 0,
      afterA: 0,
      deltaA: 0,
      beforeB: 0,
      afterB: 0,
      deltaB: 0,
    };
  }
  if (giveEspnIds.length === 0 && getEspnIds.length === 0) {
    return {
      available: false,
      reason: "Select players on both sides of the package.",
      nSims: 0,
      periodsSimulated: [],
      beforeA: 0,
      afterA: 0,
      deltaA: 0,
      beforeB: 0,
      afterB: 0,
      deltaB: 0,
    };
  }

  const nSims = options.nSims ?? Math.min(samples.n_sims_default || 300, 300);
  const seed = options.seed ?? samples.seed ?? 0;
  const before = simulatePlayoffOdds(league, samples, { nSims, seed });
  if (before.periods_simulated.length === 0) {
    return {
      available: false,
      reason:
        "Remaining H2H schedule is empty — make-playoffs is standings-locked (Δ is 0 for any trade).",
      nSims,
      periodsSimulated: [],
      beforeA: 0,
      afterA: 0,
      deltaA: 0,
      beforeB: 0,
      afterB: 0,
      deltaB: 0,
    };
  }

  const swapped = applyRosterTrade(
    league,
    teamA,
    teamB,
    giveEspnIds,
    getEspnIds,
  );
  const after = simulatePlayoffOdds(swapped, samples, { nSims, seed });
  const beforeRowA = before.teams.find((t) => t.team_id === teamA);
  const beforeRowB = before.teams.find((t) => t.team_id === teamB);
  const afterRowA = after.teams.find((t) => t.team_id === teamA);
  const afterRowB = after.teams.find((t) => t.team_id === teamB);
  const bA = beforeRowA?.make_playoffs ?? 0;
  const aA = afterRowA?.make_playoffs ?? 0;
  const bB = beforeRowB?.make_playoffs ?? 0;
  const aB = afterRowB?.make_playoffs ?? 0;

  return {
    available: true,
    nSims,
    periodsSimulated: before.periods_simulated,
    beforeA: bA,
    afterA: aA,
    deltaA: aA - bA,
    beforeB: bB,
    afterB: aB,
    deltaB: aB - bB,
  };
}

export function formatMakeDelta(delta: number): string {
  const pct = delta * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}% make-playoffs`;
}
