/**
 * Server-only golf snapshot writer (Node `fs`). Keep out of client bundles.
 */

import { promises as fs } from "fs";
import path from "path";

import type { buildGolfSnapshot } from "@/lib/golf";

function writableDataRoot(): string {
  if (process.env.SJ_DATA_DIR) return process.env.SJ_DATA_DIR;
  return path.resolve(process.cwd(), "../../data/sj");
}

function fixturesRoot(): string {
  return path.resolve(process.cwd(), "../../fixtures/sj");
}

async function readIndex(
  root: string,
): Promise<{ generated_at?: string; leagues: Array<Record<string, unknown>> }> {
  try {
    const raw = await fs.readFile(path.join(root, "index.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      generated_at?: string;
      leagues?: Array<Record<string, unknown>>;
    };
    return { generated_at: parsed.generated_at, leagues: parsed.leagues ?? [] };
  } catch {
    return { leagues: [] };
  }
}

/**
 * Write a v2 golf season into the local store and upsert index.json.
 * Seeds the writable index from fixtures when the store has no index yet so
 * creating golf does not hide ESPN fixture leagues (first-root wins).
 */
export async function writeGolfLeagueSnapshot(
  snapshot: ReturnType<typeof buildGolfSnapshot>,
): Promise<{ root: string; path: string }> {
  const root = writableDataRoot();
  const seasonDir = path.join(
    root,
    snapshot.league_id,
    String(snapshot.season),
  );
  await fs.mkdir(seasonDir, { recursive: true });

  const standingsTeams = snapshot.teams.map((team) => ({
    team_id: team.team_id,
    name: team.name,
    abbrev: team.abbrev,
    owners: team.owners,
    logo_url: team.logo_url,
    wins: team.wins,
    losses: team.losses,
    ties: team.ties,
    win_pct: team.win_pct,
    points_for: team.points_for,
    points_against: team.points_against,
    standing: team.standing,
    division: team.division,
  }));
  const rosterById: Record<string, unknown[]> = {};
  for (const team of snapshot.teams) {
    rosterById[String(team.team_id)] = team.roster ?? [];
  }
  const lineups =
    "lineups" in snapshot && snapshot.lineups
      ? snapshot.lineups
      : {
          period_label: snapshot.period_label,
          current_event_id: null,
          events: [],
          teams: {},
        };
  const files = {
    "standings.json": {
      scoring_type: snapshot.scoring_type,
      current_week: snapshot.current_week,
      period_label: snapshot.period_label,
      teams: standingsTeams,
    },
    "rosters.json": { teams: rosterById, players: snapshot.players ?? [] },
    "matchups.json": { period_label: snapshot.period_label, teams: {} },
    "draft.json": { draft: snapshot.draft ?? [] },
    "settings.json": { settings: snapshot.settings },
    "transactions.json": { transactions: [] },
    "free_agents.json": { free_agents: snapshot.free_agents ?? [] },
    "lineups.json": lineups,
  } as const;

  for (const [name, payload] of Object.entries(files)) {
    await fs.writeFile(
      path.join(seasonDir, name),
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
  }

  const manifestRel = `${snapshot.league_id}/${snapshot.season}/manifest.json`;
  const manifest = {
    schema_version: 2,
    league_id: snapshot.league_id,
    espn_league_id: null,
    sport: "golf",
    format: snapshot.format,
    season: snapshot.season,
    name: snapshot.name,
    short_name: snapshot.short_name,
    team_count: snapshot.team_count,
    synced_at: snapshot.synced_at,
    files: {
      standings: "standings.json",
      rosters: "rosters.json",
      matchups: "matchups.json",
      draft: "draft.json",
      settings: "settings.json",
      transactions: "transactions.json",
      free_agents: "free_agents.json",
      lineups: "lineups.json",
    },
  };
  await fs.writeFile(
    path.join(root, manifestRel),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  let index = await readIndex(root);
  if (!index.leagues.length) {
    index = await readIndex(fixturesRoot());
  }
  const entry = {
    league_id: snapshot.league_id,
    espn_league_id: null,
    name: snapshot.name,
    sport: "golf",
    format: snapshot.format,
    season: snapshot.season,
    team_count: snapshot.team_count,
    synced_at: snapshot.synced_at,
    path: manifestRel,
  };
  const leagues = index.leagues.filter(
    (row) =>
      !(
        row.league_id === entry.league_id &&
        Number(row.season) === entry.season
      ),
  );
  leagues.push(entry);
  leagues.sort((a, b) => {
    const id = String(a.league_id).localeCompare(String(b.league_id));
    if (id) return id;
    return Number(b.season) - Number(a.season);
  });
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, "index.json"),
    `${JSON.stringify({ generated_at: new Date().toISOString(), leagues }, null, 2)}\n`,
    "utf8",
  );

  return { root, path: manifestRel };
}
