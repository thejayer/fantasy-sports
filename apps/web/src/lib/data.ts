import { promises as fs } from "fs";
import path from "path";

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

function dataRoots(): string[] {
  const roots = [
    process.env.SJ_DATA_DIR,
    path.resolve(process.cwd(), "../../data/sj"),
    path.resolve(process.cwd(), "../../fixtures/sj"),
    path.resolve(process.cwd(), "fixtures/sj"),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(roots)];
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function getLeagueIndex(): Promise<LeagueIndexItem[]> {
  for (const root of dataRoots()) {
    const index = await readJson<{ leagues: LeagueIndexItem[] }>(path.join(root, "index.json"));
    if (index?.leagues?.length) {
      return index.leagues;
    }
  }
  return [];
}

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

export async function getLeagueSnapshot(
  leagueId: string,
  season?: number,
): Promise<LeagueSnapshot | null> {
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
    const snapshot = await readJson<LeagueSnapshot>(path.join(root, match.path));
    if (snapshot) {
      return snapshot;
    }
  }
  return null;
}

export async function getTeam(
  leagueId: string,
  teamId: number,
  season?: number,
): Promise<{ league: LeagueSnapshot; team: Team } | null> {
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
