import { promises as fs } from "fs";
import path from "path";
import { cache } from "react";

import { requireSession } from "@/lib/session";

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
};

export type TransactionAction = {
  team_id: number | null;
  action: string;
  player_id: number | null;
  player_name: string | null;
  bid_amount: number;
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

export type LeagueSnapshot = {
  league_id: string;
  short_name?: string;
  espn_league_id: number;
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
  teams: Team[];
  players: Player[];
};

export type LeagueIndexItem = {
  league_id: string;
  espn_league_id: number;
  name: string;
  sport: string;
  format: string;
  season: number;
  team_count: number;
  synced_at?: string;
  path: string;
};

type SeasonManifest = {
  schema_version: number;
  league_id: string;
  espn_league_id: number;
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

function dataRoots(): string[] {
  const roots = [
    process.env.SJ_DATA_DIR,
    path.resolve(process.cwd(), "../../data/sj"),
    path.resolve(process.cwd(), "../../fixtures/sj"),
    path.resolve(process.cwd(), "fixtures/sj"),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(roots)];
}

/**
 * Snapshots live on a read-only Cloud Storage mount refreshed by the sj-sync
 * job, so reads are cached briefly instead of hitting the mount per request.
 */
const CACHE_TTL_MS = Number(process.env.SJ_CACHE_TTL_MS ?? 60_000);
const fileCache = new Map<string, { at: number; value: unknown }>();

async function readJson<T>(filePath: string): Promise<T | null> {
  const hit = fileCache.get(filePath);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.value as T | null;
  }
  let value: T | null = null;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    value = JSON.parse(raw) as T;
  } catch {
    value = null;
  }
  fileCache.set(filePath, { at: Date.now(), value });
  return value;
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
  // Optional until seasons are re-synced after roadmap 2.4.
  const settings = manifest.files.settings
    ? await readJson<SettingsFile>(path.join(directory, manifest.files.settings))
    : null;
  const transactions = manifest.files.transactions
    ? await readJson<TransactionsFile>(
        path.join(directory, manifest.files.transactions),
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
  );
}

/**
 * Snapshot reads are gated here, not only in middleware -- see lib/session.ts.
 * `getLeagueIndex` and `getLeagueSnapshot` are the only doors to league data,
 * so guarding both means a new page cannot accidentally expose it.
 */
export const getLeagueIndex = cache(async (): Promise<LeagueIndexItem[]> => {
  await requireSession();
  for (const root of dataRoots()) {
    const index = await readJson<{ leagues: LeagueIndexItem[] }>(path.join(root, "index.json"));
    if (index?.leagues?.length) {
      return index.leagues;
    }
  }
  return [];
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
  const team: Team = {
    ...standing,
    schedule: [],
    scores: [],
    outcomes: [],
    roster: rosters.teams?.[key] ?? [],
  };
  // Minimal league façade for the team page header — no matchups/draft loaded.
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
    period_label: standings.period_label,
    synced_at: manifest.synced_at,
    schema_version: manifest.schema_version,
    draft: [],
    teams: [team],
    players: [],
  };
  return { league, team };
}
