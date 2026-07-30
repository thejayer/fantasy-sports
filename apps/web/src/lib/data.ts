import { promises as fs } from "fs";
import path from "path";
import { unstable_cache } from "next/cache";
import { cache } from "react";

import { SJ_SNAPSHOTS_CACHE_TAG } from "@/lib/cache-tags";
import { dataRoots } from "@/lib/hub-paths";
import { requireSession } from "@/lib/session";
import {
  CorruptSnapshotError,
  isNotFoundFsError,
  parseSnapshotJson,
} from "@/lib/snapshot-json";

export { CorruptSnapshotError } from "@/lib/snapshot-json";
export { SJ_SNAPSHOTS_CACHE_TAG } from "@/lib/cache-tags";
export { dataRoots, hubDataRoot, snapshotDataRoots } from "@/lib/hub-paths";

export type SeasonStats = {
  AB?: number;
  H?: number;
  R?: number;
  HR?: number;
  RBI?: number;
  SB?: number;
  AVG?: number;
  OBP?: number;
  OPS?: number;
  W?: number;
  L?: number;
  SV?: number;
  HLD?: number;
  QS?: number;
  K?: number;
  ERA?: number;
  WHIP?: number;
  OUTS?: number;
  IP?: number;
  /** Synthetic OWGR rank on golf roster rows (roadmap 6.4b). */
  OWGR?: number;
};

export type Player = {
  id: number | string | null;
  name: string | null;
  position: string | null;
  slot: string | null;
  pro_team: string | null;
  injury_status: string | null;
  status?: string | null;
  injured?: boolean;
  eligible_slots?: string[];
  acquisition_type?: string | null;
  percent_owned?: number | null;
  total_points: number | null;
  projected_total_points: number | null;
  avg_points: number | null;
  fantasy_team?: string | null;
  season_stats?: SeasonStats;
  role?: "batter" | "pitcher" | string;
};

export type DraftPick = {
  round: number | null;
  round_pick: number | null;
  team_id: number | null;
  player_id: number | null;
  player_name: string | null;
  bid_amount: number;
  keeper: boolean;
  nominating_team_id: number | null;
};

export type ScoringFormatRow = {
  id?: number | string | null;
  abbr?: string | null;
  label?: string | null;
  points?: number | null;
};

/** Nested golf knobs under ``settings.golf`` (roadmap 6.1). */
export type GolfLeagueSettings = {
  draft?: {
    style?: string;
    keepers?: boolean;
    keeper_slots?: number;
    budget?: number;
  };
  roster?: { starters?: number; bench?: number };
  captain_tiebreaker?: boolean;
  missed_cut?: { mode?: string };
  schedule?: {
    source?: string;
    include?: string[];
    exclude?: string[];
  };
  multipliers?: {
    regular?: number;
    signature?: number;
    major?: number;
  };
  scoring?: {
    grain?: string;
    player_points?: string;
    thu_fri_count?: number;
    sat_sun_count?: number;
  };
};

export type LeagueSettings = {
  scoring_type?: string | null;
  reg_season_count?: number | null;
  playoff_team_count?: number | null;
  playoff_matchup_period_length?: number | null;
  playoff_seed_tie_rule?: string | null;
  playoff_tie_rule?: string | null;
  tie_rule?: string | null;
  keeper_count?: number;
  faab?: boolean;
  acquisition_budget?: number | null;
  veto_votes_required?: number | null;
  trade_deadline?: number | null;
  team_count?: number | null;
  median_scoring?: boolean;
  division_map?: Record<string, string>;
  position_slot_counts?: Record<string, number | null>;
  scoring_format?: ScoringFormatRow[];
  /** Present on hub-native golf leagues (roadmap 6.4a). */
  golf?: GolfLeagueSettings;
};

export type TransactionAction = {
  team_id: number | null;
  action: string;
  player_id: number | null;
  player_name: string | null;
  bid_amount: number;
};

/** Posterior row from `ffa export-projections` (nflverse player_id; roadmap 4.2). */
export type ProjectionPlayer = {
  player_id: string;
  player_name: string | null;
  position: string | null;
  team: string | null;
  points_mean: number | null;
  points_sd: number | null;
  floor: number | null;
  median: number | null;
  ceiling: number | null;
  vor: number | null;
  tier: number | null;
};

export type ProjectionSnapshot = {
  schema_version: number;
  generated_at: string;
  scoring: string;
  season: number;
  n_sims: number;
  source?: Record<string, unknown>;
  players: ProjectionPlayer[];
};

/** Typical-week posterior from `ffa export-weekly-projections` (grain=typical_week). */
export type WeeklyProjectionSnapshot = ProjectionSnapshot & {
  grain: "typical_week" | string;
};

/** Offline playoff-odds MC from `ffa export-playoff-odds`. */
export type PlayoffOddsTeam = {
  team_id: number;
  name: string | null;
  standing_now: number | null;
  wins_now: number | null;
  losses_now: number | null;
  ties_now?: number | null;
  make_playoffs: number | null;
  /** Prior export make% when nightly rewrite attached week-over-week Δ. */
  make_playoffs_prior?: number | null;
  /** make_playoffs − make_playoffs_prior. */
  delta_make?: number | null;
  seed_probs: Record<string, number | null>;
  avg_wins: number | null;
  mapped_roster: number | null;
  rostered: number | null;
};

export type PlayoffOddsSnapshot = {
  schema_version: number;
  generated_at: string;
  league_id: string;
  espn_league_id?: number | null;
  season: number;
  scoring: string;
  n_sims: number;
  as_of_week?: number | null;
  reg_season_count?: number | null;
  playoff_team_count?: number | null;
  periods_simulated?: number[];
  prior_generated_at?: string | null;
  assumptions?: Record<string, unknown>;
  source?: Record<string, unknown>;
  teams: PlayoffOddsTeam[];
};

/** One player line in a football week box score (roadmap 8.1). */
export type BoxScorePlayer = {
  id: number | string | null;
  name: string | null;
  position: string | null;
  slot: string | null;
  pro_team?: string | null;
  pro_opponent?: string | null;
  on_bye_week?: boolean;
  /** League-applied fantasy points (ESPN appliedTotal) — display this. */
  points: number | null;
  projected_points?: number | null;
  injury_status?: string | null;
  game_played?: number | null;
};

export type BoxScoreMatchup = {
  home_team_id: number | null;
  away_team_id: number | null;
  home_score: number | null;
  away_score: number | null;
  home_projected?: number | null;
  away_projected?: number | null;
  is_playoff?: boolean;
  matchup_type?: string | null;
  home_lineup: BoxScorePlayer[];
  away_lineup: BoxScorePlayer[];
};

/** Side concern ``weeks/{N}.json`` — never loaded by getLeagueSnapshot. */
export type WeekBoxScoreSnapshot = {
  schema_version: number;
  league_id: string;
  season: number;
  week: number;
  sport: string;
  period_label?: string;
  synced_at?: string;
  matchups: BoxScoreMatchup[];
};

/** Compact FP draws for hub trade Δ (`ffa export-playoff-odds --write-samples`). */
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

/** One row from `ffa export-draft-sim` pick_rates (roadmap 4.5). */
export type DraftSimPickRate = {
  player_id: string;
  player_name: string | null;
  position: string | null;
  pick_rate: number | null;
  avg_round: number | null;
  avg_value: number | null;
  vor: number | null;
};

/** Availability row: round_N = P(still on board at user's Nth pick). */
export type DraftSimAvailability = {
  player_id: string;
  player_name: string | null;
  position: string | null;
  vor: number | null;
  [roundKey: string]: string | number | null | undefined;
};

export type DraftSimSnapshot = {
  schema_version: number;
  generated_at: string;
  scoring: string;
  season: number;
  user_slot: number;
  n_sims: number;
  teams: number;
  rounds: number;
  source?: Record<string, unknown>;
  pick_rates: DraftSimPickRate[];
  availability: DraftSimAvailability[];
};

export type Transaction = {
  date: string | number | null;
  actions: TransactionAction[];
};

export type Team = {
  team_id: number;
  name: string;
  abbrev: string | null;
  owners: string[];
  logo_url?: string | null;
  wins: number;
  losses: number;
  ties: number;
  win_pct?: number | null;
  points_for: number | null;
  points_against: number | null;
  standing: number | null;
  division: string;
  schedule?: number[];
  scores?: Array<number | null>;
  outcomes?: Array<"W" | "L" | "T" | "U" | string>;
  roster: Player[];
};

/** Golf weekly lineups concern (roadmap 6.4c). */
export type GolfLineupsSnapshot = {
  period_label?: string;
  current_event_id: string | null;
  events: Array<{
    event_id: string;
    name: string;
    week: number;
    starts_at: string;
    multiplier_tier: string;
    tee_times?: Record<string, string>;
  }>;
  teams: Record<
    string,
    Record<
      string,
      {
        starters: number[];
        captain: number;
        alt1?: number | null;
        alt2?: number | null;
        saved_at: string;
        locked_at?: string | null;
        locks?: Record<string, string>;
      }
    >
  >;
};

/** Golf EOD scoreboard concern (roadmap 6.4d). */
export type GolfScoreboardRound = {
  round: number;
  label: string;
  points: number;
  counted_player_ids: number[];
  dropped_player_ids: number[];
  slots: Array<{
    player_id: number;
    starter_id: number;
    source: string;
    status: string;
    to_par: number | null;
    points: number;
  }>;
};

export type GolfScoreboardTeamWeek = {
  starters: number[];
  captain: number;
  alt1?: number | null;
  alt2?: number | null;
  week_raw: number;
  week_total: number;
  captain_week: number;
  multiplier: number;
  by_round: Record<string, GolfScoreboardRound>;
};

export type GolfScoreboardEvent = {
  event_id: string;
  name?: string | null;
  week?: number | null;
  multiplier_tier: string;
  multiplier: number;
  scored_at: string;
  teams: Record<string, GolfScoreboardTeamWeek>;
  pairings: Array<{
    home_team_id: number;
    away_team_id: number;
    home_name?: string | null;
    away_name?: string | null;
    home_total: number;
    away_total: number;
    home_captain_week?: number;
    away_captain_week?: number;
    outcome: "W" | "L" | "T" | string;
  }>;
};

export type GolfScoreboardSnapshot = {
  period_label?: string;
  current_event_id: string | null;
  events: GolfScoreboardEvent[];
};

export type LeagueSnapshot = {
  league_id: string;
  short_name?: string;
  /** Null for hub-native sports (golf). */
  espn_league_id: number | null;
  sport: string;
  format: string;
  season: number;
  name: string;
  scoring_type?: string | null;
  team_count: number;
  current_week: number | null;
  period_label?: string;
  synced_at?: string;
  schema_version?: number;
  settings?: LeagueSettings;
  draft?: DraftPick[];
  transactions?: Transaction[];
  /** ESPN FREEAGENT + WAIVERS pool (size-capped at sync); empty before 2019. */
  free_agents?: Player[];
  /** Present on hub-native golf leagues after 6.4c. */
  lineups?: GolfLineupsSnapshot;
  /** Present on hub-native golf leagues after 6.4d. */
  scoreboard?: GolfScoreboardSnapshot;
  teams: Team[];
  players: Player[];
};

export type LeagueIndexItem = {
  league_id: string;
  espn_league_id: number | null;
  name: string;
  sport: string;
  format: string;
  season: number;
  team_count: number;
  synced_at?: string;
  path: string;
};

/** One franchise row for history aggregation (no roster payload). */
export type HistoryTeam = {
  team_id: number;
  name: string;
  abbrev: string | null;
  owners: string[];
  wins: number;
  losses: number;
  ties: number;
  points_for: number | null;
  points_against: number | null;
  standing: number | null;
  schedule: number[];
  scores: Array<number | null>;
  outcomes: string[];
};

export type SeasonHistorySlice = {
  season: number;
  period_label?: string;
  teams: HistoryTeam[];
};

/** Multi-season standings + matchups for roadmap 3.5 (skips rosters). */
export type LeagueHistoryArchive = {
  league_id: string;
  name: string;
  sport: string;
  format: string;
  seasons: SeasonHistorySlice[];
};

type SeasonManifest = {
  schema_version: number;
  league_id: string;
  espn_league_id: number | null;
  sport: string;
  format: string;
  season: number;
  name: string;
  short_name?: string;
  team_count: number;
  synced_at?: string;
  files: Record<string, string>;
};

type StandingsFile = {
  scoring_type?: string | null;
  current_week: number | null;
  period_label?: string;
  teams: Array<Omit<Team, "roster" | "schedule" | "scores" | "outcomes">>;
};

type RostersFile = {
  teams: Record<string, Player[]>;
  players: Player[];
};

type MatchupsFile = {
  period_label?: string;
  current_week?: number | null;
  teams: Record<
    string,
    {
      schedule?: number[];
      scores?: Array<number | null>;
      outcomes?: string[];
    }
  >;
};

type DraftFile = {
  draft: DraftPick[];
};

type SettingsFile = {
  settings: LeagueSettings;
};

type TransactionsFile = {
  transactions: Transaction[];
};

type FreeAgentsFile = {
  free_agents: Player[];
};

type LineupsFile = GolfLineupsSnapshot;
type ScoreboardFile = GolfScoreboardSnapshot;

/**
 * Snapshots live on a Cloud Storage mount refreshed by the sj-sync job.
 * Hub-native golf uses `SJ_HUB_DIR` (prod: same path as `SJ_DATA_DIR`).
 * Reads go through Next's Data Cache (`unstable_cache`) with TTL from
 * `SJ_CACHE_TTL_MS` (default 60s) and tag `sj-snapshots` for explicit
 * revalidation via `POST /api/revalidate` after sync.
 */
const CACHE_TTL_MS = Number(process.env.SJ_CACHE_TTL_MS ?? 60_000);
const CACHE_REVALIDATE_SECONDS = Math.max(1, Math.ceil(CACHE_TTL_MS / 1000));

/**
 * Uncached disk read. Corrupt JSON throws (must not be stored as null).
 * Missing file → null.
 */
async function readJsonFromDisk<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return parseSnapshotJson<T>(raw, filePath);
  } catch (err) {
    if (err instanceof CorruptSnapshotError) {
      console.error("[sj-hub] corrupt snapshot", filePath, err.cause ?? err);
      throw err;
    }
    if (isNotFoundFsError(err)) {
      return null;
    }
    console.error("[sj-hub] snapshot read failed", filePath, err);
    throw err;
  }
}

/**
 * Read JSON with the Next.js Data Cache.
 * - Missing file (ENOENT) → `null`, cached until revalidate/TTL
 * - Corrupt JSON → throws CorruptSnapshotError (not cached as null)
 * - Other FS errors → rethrown, not cached
 */
async function readJson<T>(filePath: string): Promise<T | null> {
  return unstable_cache(
    async () => readJsonFromDisk<T>(filePath),
    ["sj-readJson", filePath],
    {
      revalidate: CACHE_REVALIDATE_SECONDS,
      tags: [SJ_SNAPSHOTS_CACHE_TAG],
    },
  )();
}

function isManifestPath(indexPath: string): boolean {
  return indexPath.endsWith("/manifest.json") || indexPath.endsWith("manifest.json");
}

function assembleFromParts(
  manifest: SeasonManifest,
  standings: StandingsFile,
  rosters: RostersFile,
  matchups: MatchupsFile | null,
  draft: DraftFile | null,
  settings: SettingsFile | null,
  transactions: TransactionsFile | null,
  freeAgents: FreeAgentsFile | null,
  lineups: LineupsFile | null,
  scoreboard: ScoreboardFile | null,
): LeagueSnapshot {
  const matchupById = matchups?.teams ?? {};
  const rosterById = rosters.teams ?? {};
  const teams: Team[] = (standings.teams ?? []).map((team) => {
    const key = String(team.team_id);
    const m = matchupById[key] ?? {};
    return {
      ...team,
      schedule: m.schedule ?? [],
      scores: m.scores ?? [],
      outcomes: m.outcomes ?? [],
      roster: rosterById[key] ?? [],
    };
  });
  return {
    league_id: manifest.league_id,
    short_name: manifest.short_name,
    espn_league_id: manifest.espn_league_id,
    sport: manifest.sport,
    format: manifest.format,
    season: manifest.season,
    name: manifest.name,
    scoring_type: standings.scoring_type,
    team_count: manifest.team_count,
    current_week: standings.current_week,
    period_label: standings.period_label,
    synced_at: manifest.synced_at,
    schema_version: manifest.schema_version,
    settings: settings?.settings ?? {},
    draft: draft?.draft ?? [],
    transactions: transactions?.transactions ?? [],
    free_agents: freeAgents?.free_agents ?? [],
    lineups: lineups ?? undefined,
    scoreboard: scoreboard ?? undefined,
    teams,
    players: rosters.players ?? [],
  };
}

async function loadSnapshotFromRoot(
  root: string,
  indexPath: string,
): Promise<LeagueSnapshot | null> {
  const absolute = path.join(root, indexPath);
  if (!isManifestPath(indexPath)) {
    // schema_version 1 monolith (committed fixtures).
    return readJson<LeagueSnapshot>(absolute);
  }

  const directory = path.dirname(absolute);
  const manifest = await readJson<SeasonManifest>(absolute);
  if (!manifest?.files) {
    return null;
  }
  const standings = await readJson<StandingsFile>(
    path.join(directory, manifest.files.standings ?? "standings.json"),
  );
  const rosters = await readJson<RostersFile>(
    path.join(directory, manifest.files.rosters ?? "rosters.json"),
  );
  if (!standings || !rosters) {
    return null;
  }
  const matchups = manifest.files.matchups
    ? await readJson<MatchupsFile>(path.join(directory, manifest.files.matchups))
    : null;
  const draft = manifest.files.draft
    ? await readJson<DraftFile>(path.join(directory, manifest.files.draft))
    : null;
  // Optional until seasons are re-synced after settings / FA sync slices.
  const settings = manifest.files.settings
    ? await readJson<SettingsFile>(path.join(directory, manifest.files.settings))
    : null;
  const transactions = manifest.files.transactions
    ? await readJson<TransactionsFile>(
        path.join(directory, manifest.files.transactions),
      )
    : null;
  const freeAgents = manifest.files.free_agents
    ? await readJson<FreeAgentsFile>(
        path.join(directory, manifest.files.free_agents),
      )
    : null;
  const lineups = manifest.files.lineups
    ? await readJson<LineupsFile>(path.join(directory, manifest.files.lineups))
    : null;
  const scoreboard = manifest.files.scoreboard
    ? await readJson<ScoreboardFile>(
        path.join(directory, manifest.files.scoreboard),
      )
    : null;
  return assembleFromParts(
    manifest,
    standings,
    rosters,
    matchups,
    draft,
    settings,
    transactions,
    freeAgents,
    lineups,
    scoreboard,
  );
}

/**
 * Snapshot reads are gated here, not only in middleware -- see lib/session.ts.
 * `getLeagueIndex` and `getLeagueSnapshot` are the only doors to league data,
 * so guarding both means a new page cannot accidentally expose it.
 */
export const getLeagueIndex = cache(async (): Promise<LeagueIndexItem[]> => {
  await requireSession();
  // Merge every root's index. Later roots win on (league_id, season) so the
  // hub-native root (listed first in dataRoots) is overlaid by ESPN only when
  // keys collide — we reverse-merge so hub/golf wins collisions.
  const byKey = new Map<string, LeagueIndexItem>();
  for (const root of [...dataRoots()].reverse()) {
    const index = await readJson<{ leagues: LeagueIndexItem[] }>(
      path.join(root, "index.json"),
    );
    for (const row of index?.leagues ?? []) {
      byKey.set(`${row.league_id}:${row.season}`, row);
    }
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.league_id.localeCompare(b.league_id) || b.season - a.season,
  );
});

export async function getLatestLeagues(): Promise<LeagueIndexItem[]> {
  const all = await getLeagueIndex();
  const latest = new Map<string, LeagueIndexItem>();
  for (const item of all) {
    const prev = latest.get(item.league_id);
    if (!prev || item.season > prev.season) {
      latest.set(item.league_id, item);
    }
  }
  return [...latest.values()].sort((a, b) => a.sport.localeCompare(b.sport) || a.name.localeCompare(b.name));
}

export async function getLeagueSeasons(leagueId: string): Promise<number[]> {
  const all = await getLeagueIndex();
  return [...new Set(all.filter((item) => item.league_id === leagueId).map((item) => item.season))]
    .sort((a, b) => b - a);
}

async function loadHistorySliceFromRoot(
  root: string,
  indexPath: string,
  season: number,
): Promise<SeasonHistorySlice | null> {
  const absolute = path.join(root, indexPath);
  if (!isManifestPath(indexPath)) {
    const monolith = await readJson<LeagueSnapshot>(absolute);
    if (!monolith?.teams?.length) return null;
    return {
      season: monolith.season ?? season,
      period_label: monolith.period_label,
      teams: monolith.teams.map((team) => ({
        team_id: team.team_id,
        name: team.name,
        abbrev: team.abbrev,
        owners: team.owners ?? [],
        wins: team.wins,
        losses: team.losses,
        ties: team.ties,
        points_for: team.points_for,
        points_against: team.points_against,
        standing: team.standing,
        schedule: team.schedule ?? [],
        scores: team.scores ?? [],
        outcomes: (team.outcomes ?? []).map(String),
      })),
    };
  }

  const directory = path.dirname(absolute);
  const manifest = await readJson<SeasonManifest>(absolute);
  if (!manifest?.files) return null;
  const standings = await readJson<StandingsFile>(
    path.join(directory, manifest.files.standings ?? "standings.json"),
  );
  if (!standings?.teams?.length) return null;
  const matchups = manifest.files.matchups
    ? await readJson<MatchupsFile>(path.join(directory, manifest.files.matchups))
    : null;
  const matchupById = matchups?.teams ?? {};
  return {
    season: manifest.season ?? season,
    period_label: standings.period_label ?? matchups?.period_label,
    teams: standings.teams.map((team) => {
      const m = matchupById[String(team.team_id)] ?? {};
      return {
        team_id: team.team_id,
        name: team.name,
        abbrev: team.abbrev,
        owners: team.owners ?? [],
        wins: team.wins,
        losses: team.losses,
        ties: team.ties,
        points_for: team.points_for,
        points_against: team.points_against,
        standing: team.standing,
        schedule: m.schedule ?? [],
        scores: m.scores ?? [],
        outcomes: (m.outcomes ?? []).map(String),
      };
    }),
  };
}

/**
 * Load every season's standings + matchup arrays for a league (roadmap 3.5).
 * Skips rosters/draft/transactions so decade views stay cheap.
 */
export const getLeagueHistoryArchive = cache(
  async (leagueId: string): Promise<LeagueHistoryArchive | null> => {
    await requireSession();
    const index = await getLeagueIndex();
    const items = index
      .filter((item) => item.league_id === leagueId)
      .sort((a, b) => a.season - b.season);
    if (!items.length) return null;

    const seasons: SeasonHistorySlice[] = [];
    for (const item of items) {
      let slice: SeasonHistorySlice | null = null;
      for (const root of dataRoots()) {
        slice = await loadHistorySliceFromRoot(root, item.path, item.season);
        if (slice) break;
      }
      if (slice) seasons.push(slice);
    }
    if (!seasons.length) return null;

    const latest = items[items.length - 1];
    return {
      league_id: leagueId,
      name: latest.name,
      sport: latest.sport,
      format: latest.format,
      seasons,
    };
  },
);

export const getLeagueSnapshot = cache(
  async (leagueId: string, season?: number): Promise<LeagueSnapshot | null> => {
    await requireSession();
    const index = await getLeagueIndex();
    const candidates = index
      .filter((item) => item.league_id === leagueId)
      .sort((a, b) => b.season - a.season);
    const match = season
      ? candidates.find((item) => item.season === season)
      : candidates[0];
    if (!match) {
      return null;
    }

    for (const root of dataRoots()) {
      const snapshot = await loadSnapshotFromRoot(root, match.path);
      if (snapshot) {
        return snapshot;
      }
    }
    return null;
  },
);

/**
 * Read an ffa projection snapshot written under ``projections/{scoring}/{season}.json``.
 * Session-gated like league data. UI surfaces land in roadmap 4.4; join ESPN roster
 * ids via {@link getPlayerMap} (roadmap 4.3).
 */
export const getProjectionSnapshot = cache(
  async (scoring: string, season: number): Promise<ProjectionSnapshot | null> => {
    await requireSession();
    const slug = scoring.trim().toLowerCase();
    const relative = path.join("projections", slug, `${season}.json`);
    for (const root of dataRoots()) {
      const doc = await readJson<ProjectionSnapshot>(path.join(root, relative));
      if (doc?.players?.length && doc.season === season) {
        return doc;
      }
    }
    return null;
  },
);

/**
 * Read a typical-week posterior under
 * ``weekly_projections/{scoring}/{season}.json``. Session-gated; hub never
 * invokes ``ffa``. Not schedule-adjusted — use for start/sit, not playoff odds.
 */
export const getWeeklyProjectionSnapshot = cache(
  async (
    scoring: string,
    season: number,
  ): Promise<WeeklyProjectionSnapshot | null> => {
    await requireSession();
    const slug = scoring.trim().toLowerCase();
    const relative = path.join("weekly_projections", slug, `${season}.json`);
    for (const root of dataRoots()) {
      const doc = await readJson<WeeklyProjectionSnapshot>(
        path.join(root, relative),
      );
      if (
        doc?.players?.length &&
        doc.season === season &&
        doc.grain === "typical_week"
      ) {
        return doc;
      }
    }
    return null;
  },
);

/**
 * Read playoff-odds MC under ``playoff_odds/{league_id}/{season}.json``.
 * Session-gated; produced offline by ``ffa export-playoff-odds``.
 */
export const getPlayoffOddsSnapshot = cache(
  async (
    leagueId: string,
    season: number,
  ): Promise<PlayoffOddsSnapshot | null> => {
    await requireSession();
    const relative = path.join("playoff_odds", leagueId, `${season}.json`);
    for (const root of dataRoots()) {
      const doc = await readJson<PlayoffOddsSnapshot>(path.join(root, relative));
      if (doc?.teams?.length && doc.season === season) {
        return doc;
      }
    }
    return null;
  },
);

/**
 * Resolve the on-disk directory that holds ``weeks/`` for a league-season.
 * v2: ``{league}/{season}/`` beside manifest; v1 fixtures: ``{league}/{season}/``
 * beside the monolith ``{league}/{season}.json``.
 */
function weekBoxScoreDir(indexPath: string): string {
  if (
    indexPath.endsWith("/manifest.json") ||
    indexPath.endsWith("manifest.json")
  ) {
    return path.dirname(indexPath);
  }
  if (indexPath.endsWith(".json")) {
    // football-main/2026.json → football-main/2026/
    return indexPath.slice(0, -".json".length);
  }
  return indexPath;
}

/**
 * Football week box scores under ``{league}/{season}/weeks/{N}.json``.
 * Session-gated; never called from standings/roster/history paths.
 */
export const getWeekBoxScore = cache(
  async (
    leagueId: string,
    season: number,
    week: number,
  ): Promise<WeekBoxScoreSnapshot | null> => {
    await requireSession();
    if (!Number.isInteger(week) || week < 1) return null;
    const index = await getLeagueIndex();
    const match = index.find(
      (item) => item.league_id === leagueId && item.season === season,
    );
    if (!match) return null;

    for (const root of dataRoots()) {
      const dir = weekBoxScoreDir(match.path);
      const relative = path.join(dir, "weeks", `${week}.json`);
      const doc = await readJson<WeekBoxScoreSnapshot>(
        path.join(root, relative),
      );
      if (
        doc?.matchups &&
        doc.week === week &&
        doc.season === season &&
        doc.sport === "football"
      ) {
        return doc;
      }
    }
    return null;
  },
);

/**
 * Week numbers that have an on-disk ``weeks/{N}.json`` for this league-season.
 * Union across data roots (like ``listDraftSimSlots``). Session-gated.
 * Player game logs list these then call ``getWeekBoxScore`` per week.
 */
export const listWeekBoxScoreWeeks = cache(
  async (leagueId: string, season: number): Promise<number[]> => {
    await requireSession();
    const index = await getLeagueIndex();
    const match = index.find(
      (item) => item.league_id === leagueId && item.season === season,
    );
    if (!match) return [];

    const found = new Set<number>();
    const dirRel = path.join(weekBoxScoreDir(match.path), "weeks");
    for (const root of dataRoots()) {
      const dir = path.join(root, dirRel);
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch (err) {
        if (isNotFoundFsError(err)) continue;
        throw err;
      }
      for (const name of entries) {
        const m = /^(\d+)\.json$/.exec(name);
        if (!m) continue;
        const week = Number(m[1]);
        if (Number.isInteger(week) && week >= 1) found.add(week);
      }
    }
    return [...found].sort((a, b) => a - b);
  },
);

/**
 * Read playoff FP samples under ``playoff_odds/{league_id}/{season}.samples.json``
 * for Trade Desk Δ make-playoffs (roadmap 7.8).
 */
export const getPlayoffOddsSamples = cache(
  async (
    leagueId: string,
    season: number,
  ): Promise<PlayoffOddsSamples | null> => {
    await requireSession();
    const relative = path.join(
      "playoff_odds",
      leagueId,
      `${season}.samples.json`,
    );
    for (const root of dataRoots()) {
      const doc = await readJson<PlayoffOddsSamples>(path.join(root, relative));
      if (
        doc?.points_by_espn &&
        doc.season === season &&
        Object.keys(doc.points_by_espn).length > 0
      ) {
        return doc;
      }
    }
    return null;
  },
);

/**
 * Read an ffa draft-sim snapshot under
 * ``draft_sim/{scoring}/{season}/slot_{N}.json`` (roadmap 4.5).
 */
export const getDraftSimSnapshot = cache(
  async (
    scoring: string,
    season: number,
    userSlot: number,
  ): Promise<DraftSimSnapshot | null> => {
    await requireSession();
    if (!Number.isFinite(userSlot) || userSlot < 1) return null;
    const slug = scoring.trim().toLowerCase();
    const relative = path.join(
      "draft_sim",
      slug,
      String(season),
      `slot_${Math.trunc(userSlot)}.json`,
    );
    for (const root of dataRoots()) {
      const doc = await readJson<DraftSimSnapshot>(path.join(root, relative));
      if (
        doc?.pick_rates &&
        doc.season === season &&
        doc.user_slot === Math.trunc(userSlot)
      ) {
        return doc;
      }
    }
    return null;
  },
);

/**
 * List draft-sim slots that exist on disk for ``draft_sim/{scoring}/{season}/``.
 * Hub UI should only offer these — fixtures often ship a subset (e.g. 1,6,7,12).
 */
export const listDraftSimSlots = cache(
  async (scoring: string, season: number): Promise<number[]> => {
    await requireSession();
    const slug = scoring.trim().toLowerCase();
    const found = new Set<number>();
    for (const root of dataRoots()) {
      const dir = path.join(root, "draft_sim", slug, String(season));
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch (err) {
        if (isNotFoundFsError(err)) continue;
        throw err;
      }
      for (const name of entries) {
        const match = /^slot_(\d+)\.json$/.exec(name);
        if (!match) continue;
        const slot = Number(match[1]);
        if (Number.isFinite(slot) && slot >= 1) found.add(Math.trunc(slot));
      }
    }
    return [...found].sort((a, b) => a - b);
  },
);

/** One ESPN ↔ nflverse row from `ffa export-player-map` (roadmap 4.3). */
export type PlayerMapEntry = {
  espn_id: string;
  player_id: string;
  name?: string | null;
  position?: string | null;
  method?: string | null;
};

export type PlayerMapCoverage = {
  rostered: number;
  resolved: number;
  rate: number | null;
  misses?: Array<{
    espn_id: string;
    name?: string | null;
    position?: string | null;
    reason?: string | null;
  }>;
};

export type PlayerMapSnapshot = {
  schema_version: number;
  generated_at: string;
  season: number;
  stats?: Record<string, unknown>;
  coverage: PlayerMapCoverage;
  source?: Record<string, unknown>;
  mappings: PlayerMapEntry[];
};

/**
 * ESPN → nflverse (GSIS) crosswalk under ``player_map/{season}.json``.
 * Session-gated. Projection UI (4.4) joins roster ``Player.id`` through this map.
 */
export const getPlayerMap = cache(
  async (season: number): Promise<PlayerMapSnapshot | null> => {
    await requireSession();
    const relative = path.join("player_map", `${season}.json`);
    for (const root of dataRoots()) {
      const doc = await readJson<PlayerMapSnapshot>(path.join(root, relative));
      if (doc?.mappings && doc.season === season) {
        return doc;
      }
    }
    return null;
  },
);

/**
 * Load one team without pulling matchups/draft/transactions when the season is
 * on the v2 layout — the point of the schema split (AUDIT #16).
 */
export async function getTeam(
  leagueId: string,
  teamId: number,
  season?: number,
): Promise<{ league: LeagueSnapshot; team: Team } | null> {
  // Auth is enforced by getLeagueIndex / getLeagueSnapshot — the only doors.
  const index = await getLeagueIndex();
  const candidates = index
    .filter((item) => item.league_id === leagueId)
    .sort((a, b) => b.season - a.season);
  const match = season
    ? candidates.find((item) => item.season === season)
    : candidates[0];
  if (!match) {
    return null;
  }

  if (isManifestPath(match.path)) {
    for (const root of dataRoots()) {
      const selective = await loadTeamSelective(root, match.path, teamId);
      if (selective) {
        return selective;
      }
    }
  }

  const league = await getLeagueSnapshot(leagueId, season);
  if (!league) {
    return null;
  }
  const team = league.teams.find((item) => item.team_id === teamId);
  if (!team) {
    return null;
  }
  return { league, team };
}

async function loadTeamSelective(
  root: string,
  indexPath: string,
  teamId: number,
): Promise<{ league: LeagueSnapshot; team: Team } | null> {
  const directory = path.join(root, path.dirname(indexPath));
  const manifest = await readJson<SeasonManifest>(path.join(root, indexPath));
  if (!manifest?.files) {
    return null;
  }
  const standings = await readJson<StandingsFile>(
    path.join(directory, manifest.files.standings ?? "standings.json"),
  );
  const rosters = await readJson<RostersFile>(
    path.join(directory, manifest.files.rosters ?? "rosters.json"),
  );
  if (!standings || !rosters) {
    return null;
  }
  const key = String(teamId);
  const standing = (standings.teams ?? []).find((item) => item.team_id === teamId);
  if (!standing) {
    return null;
  }
  // A team page with no results on it is the one thing a team page is for
  // (roadmap 7.4). matchups.json is the smallest concern in the split — no
  // rosters, no draft, no transactions — so read it here rather than leaving
  // schedule/scores/outcomes empty as the original 2.2 fast path did.
  const matchups = manifest.files.matchups
    ? await readJson<MatchupsFile>(path.join(directory, manifest.files.matchups))
    : null;
  const mine = matchups?.teams?.[key] ?? {};
  const team: Team = {
    ...standing,
    schedule: mine.schedule ?? [],
    scores: mine.scores ?? [],
    outcomes: mine.outcomes ?? [],
    roster: rosters.teams?.[key] ?? [],
  };
  // Opponent names for the game log come from standings, which is already
  // loaded; their rosters are not, so they carry schedule/score arrays only.
  const opponents: Team[] = (standings.teams ?? [])
    .filter((item) => item.team_id !== teamId)
    .map((item) => {
      const other = matchups?.teams?.[String(item.team_id)] ?? {};
      return {
        ...item,
        schedule: other.schedule ?? [],
        scores: other.scores ?? [],
        outcomes: other.outcomes ?? [],
        roster: [],
      };
    });
  const league: LeagueSnapshot = {
    league_id: manifest.league_id,
    short_name: manifest.short_name,
    espn_league_id: manifest.espn_league_id,
    sport: manifest.sport,
    format: manifest.format,
    season: manifest.season,
    name: manifest.name,
    scoring_type: standings.scoring_type,
    team_count: manifest.team_count,
    current_week: standings.current_week,
    period_label: standings.period_label ?? matchups?.period_label,
    synced_at: manifest.synced_at,
    schema_version: manifest.schema_version,
    draft: [],
    teams: [team, ...opponents],
    players: [],
  };
  return { league, team };
}
