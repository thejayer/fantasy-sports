/**
 * Read-only view of the hub's synced ESPN leagues, for the casino's team
 * linking: which leagues and teams exist, and each team's decided matchup
 * results. Reads the same snapshot files the hub app does (`index.json`, then
 * a season's manifest + standings + matchups, or the legacy single-file
 * snapshot). ESPN league ids and other ids are never returned.
 */

import { readHubFile } from "@/lib/data-source";

export type HubLeague = {
  leagueId: string;
  name: string;
  season: number;
  /** Relative path of the season's manifest (split) or snapshot (legacy). */
  path: string;
};

export type HubTeam = { team: string; label: string; owner: string };

export type HubResult = {
  team: string;
  period: number;
  /** W, L or T once decided; U while undecided (or a bye). */
  outcome: "W" | "L" | "T" | "U";
};

export type HubSeason = {
  league: HubLeague;
  teams: HubTeam[];
  results: HubResult[];
};

const LEAGUE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TEAM_ID = /^[A-Za-z0-9_-]{1,12}$/;
const REL_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const MAX_TEAMS = 40;
const MAX_PERIODS = 60;

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

async function readJson(rel: string): Promise<unknown | null> {
  try {
    const raw = await readHubFile(rel);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function text(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const clean = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean.includes("@") ? "" : Array.from(clean).slice(0, max).join("");
}

/**
 * The Strictly Jayers leagues that come from ESPN. Hub-native leagues (golf)
 * have no ESPN matchups, so they are not offered.
 */
export async function listEspnLeagues(): Promise<HubLeague[] | null> {
  const index = rec(await readJson("index.json"));
  if (!index || !Array.isArray(index.leagues)) return null;
  const out: HubLeague[] = [];
  for (const raw of index.leagues) {
    const l = rec(raw);
    if (!l) continue;
    const leagueId = l.league_id;
    const season = l.season;
    const path = l.path;
    if (typeof leagueId !== "string" || !LEAGUE_ID.test(leagueId)) continue;
    if (!Number.isInteger(season) || (season as number) < 2000) continue;
    if (typeof path !== "string" || !REL_PATH.test(path)) continue;
    if (l.espn_league_id == null) continue;
    out.push({
      leagueId,
      name: text(l.name, 60) || leagueId,
      season: season as number,
      path,
    });
  }
  return out;
}

type RawTeam = {
  id: string;
  label: string;
  owner: string;
  schedule: unknown[];
  outcomes: unknown[];
};

function teamId(v: unknown): string | null {
  const s = typeof v === "number" && Number.isInteger(v) ? String(v) : v;
  return typeof s === "string" && TEAM_ID.test(s) ? s : null;
}

function labelOf(t: Record<string, unknown>, id: string): string {
  return text(t.name, 60) || text(t.abbrev, 12) || `Team ${id}`;
}

function ownerOf(t: Record<string, unknown>): string {
  const owners = Array.isArray(t.owners) ? t.owners : [];
  return text(
    owners
      .map((o) => text(o, 40))
      .filter(Boolean)
      .join(", "),
    40,
  );
}

/** Teams plus per-period outcomes, from either snapshot layout. */
async function readTeams(league: HubLeague): Promise<RawTeam[] | null> {
  const doc = rec(await readJson(league.path));
  if (!doc) return null;
  const files = rec(doc.files);
  const out: RawTeam[] = [];
  if (files) {
    // Split layout: {league}/{season}/manifest.json + standings + matchups.
    const dir = league.path.includes("/")
      ? league.path.slice(0, league.path.lastIndexOf("/") + 1)
      : "";
    const standingsName = files.standings;
    const matchupsName = files.matchups;
    if (typeof standingsName !== "string" || typeof matchupsName !== "string")
      return null;
    const standings = rec(await readJson(dir + standingsName));
    const matchups = rec(await readJson(dir + matchupsName));
    if (!standings || !matchups || !Array.isArray(standings.teams)) return null;
    const byId = rec(matchups.teams) ?? {};
    for (const raw of standings.teams.slice(0, MAX_TEAMS)) {
      const t = rec(raw);
      const id = t ? teamId(t.team_id) : null;
      if (!t || !id) continue;
      const m = rec(byId[id]) ?? {};
      out.push({
        id,
        label: labelOf(t, id),
        owner: ownerOf(t),
        schedule: Array.isArray(m.schedule) ? m.schedule : [],
        outcomes: Array.isArray(m.outcomes) ? m.outcomes : [],
      });
    }
    return out;
  }
  // Legacy single-file snapshot.
  if (!Array.isArray(doc.teams)) return null;
  for (const raw of doc.teams.slice(0, MAX_TEAMS)) {
    const t = rec(raw);
    const id = t ? teamId(t.team_id) : null;
    if (!t || !id) continue;
    out.push({
      id,
      label: labelOf(t, id),
      owner: ownerOf(t),
      schedule: Array.isArray(t.schedule) ? t.schedule : [],
      outcomes: Array.isArray(t.outcomes) ? t.outcomes : [],
    });
  }
  return out;
}

function resultsOf(t: RawTeam): HubResult[] {
  const out: HubResult[] = [];
  for (let i = 0; i < Math.min(t.outcomes.length, MAX_PERIODS); i += 1) {
    const raw = t.outcomes[i];
    // A bye (the team's own id in the schedule) is never a matchup win.
    const bye = teamId(t.schedule[i]) === t.id;
    const outcome =
      !bye && (raw === "W" || raw === "L" || raw === "T") ? raw : "U";
    out.push({ team: t.id, period: i + 1, outcome });
  }
  return out;
}

/** One league's current season: its teams and every team's results. */
export async function readSeason(league: HubLeague): Promise<HubSeason | null> {
  const teams = await readTeams(league);
  if (!teams) return null;
  return {
    league,
    teams: teams.map((t) => ({ team: t.id, label: t.label, owner: t.owner })),
    results: teams.flatMap(resultsOf),
  };
}
