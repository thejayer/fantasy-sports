/**
 * Regression guard for roadmap 7.4.
 *
 * `loadTeamSelective` is the v2 fast path for team pages. It used to build the
 * team without reading `matchups.json`, leaving `schedule` / `scores` /
 * `outcomes` empty — so team pages rendered a roster and no results, silently.
 * The committed fixtures are v1 monoliths, so only a real v2 layout on disk can
 * catch this coming back.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));
vi.mock("@/lib/session", () => ({
  requireSession: async () => null,
  devBypassEnabled: () => true,
}));

let root: string;
let prevDataDir: string | undefined;
let prevHubDir: string | undefined;

const SEASON = 2026;
const LEAGUE = "regress-main";

async function writeJson(relative: string, payload: unknown): Promise<void> {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(payload), "utf8");
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "sj-v2-"));
  prevDataDir = process.env.SJ_DATA_DIR;
  prevHubDir = process.env.SJ_HUB_DIR;
  process.env.SJ_DATA_DIR = root;
  process.env.SJ_HUB_DIR = root;

  const dir = `${LEAGUE}/${SEASON}`;
  await writeJson(`${dir}/manifest.json`, {
    schema_version: 2,
    league_id: LEAGUE,
    espn_league_id: 4242,
    sport: "football",
    format: "redraft",
    season: SEASON,
    name: "Regression League",
    team_count: 2,
    synced_at: "2026-07-30T00:00:00Z",
    files: {
      standings: "standings.json",
      rosters: "rosters.json",
      matchups: "matchups.json",
    },
  });
  await writeJson(`${dir}/standings.json`, {
    scoring_type: "H2H_POINTS",
    current_week: 2,
    period_label: "week",
    teams: [
      {
        team_id: 1,
        name: "Alpha",
        abbrev: "ALP",
        owners: ["Owner A"],
        wins: 1,
        losses: 1,
        ties: 0,
        points_for: 190,
        points_against: 185,
        standing: 1,
        division: "",
      },
      {
        team_id: 2,
        name: "Bravo",
        abbrev: "BRV",
        owners: ["Owner B"],
        wins: 1,
        losses: 1,
        ties: 0,
        points_for: 185,
        points_against: 190,
        standing: 2,
        division: "",
      },
    ],
  });
  await writeJson(`${dir}/rosters.json`, {
    teams: {
      "1": [
        {
          id: 11,
          name: "Player One",
          position: "QB",
          slot: "QB",
          pro_team: "KC",
          injury_status: null,
          total_points: 100,
          projected_total_points: null,
          avg_points: null,
        },
      ],
      "2": [],
    },
    players: [],
  });
  await writeJson(`${dir}/matchups.json`, {
    period_label: "week",
    current_week: 2,
    teams: {
      "1": { schedule: [2, 2], scores: [100, 90], outcomes: ["W", "L"] },
      "2": { schedule: [1, 1], scores: [95, 90], outcomes: ["L", "W"] },
    },
  });
  await writeJson("index.json", {
    leagues: [
      {
        league_id: LEAGUE,
        espn_league_id: 4242,
        name: "Regression League",
        sport: "football",
        format: "redraft",
        season: SEASON,
        team_count: 2,
        path: `${dir}/manifest.json`,
      },
    ],
  });
});

afterAll(async () => {
  if (prevDataDir === undefined) delete process.env.SJ_DATA_DIR;
  else process.env.SJ_DATA_DIR = prevDataDir;
  if (prevHubDir === undefined) delete process.env.SJ_HUB_DIR;
  else process.env.SJ_HUB_DIR = prevHubDir;
  await fs.rm(root, { recursive: true, force: true });
});

describe("getTeam on a schema_version 2 snapshot", () => {
  it("returns the team's own schedule, scores, and outcomes", async () => {
    const { getTeam } = await import("@/lib/data");
    const result = await getTeam(LEAGUE, 1, SEASON);
    expect(result).not.toBeNull();
    expect(result!.team.schedule).toEqual([2, 2]);
    expect(result!.team.scores).toEqual([100, 90]);
    expect(result!.team.outcomes).toEqual(["W", "L"]);
    expect(result!.team.roster).toHaveLength(1);
  });

  it("includes opponents so the game log can name them", async () => {
    const { getTeam } = await import("@/lib/data");
    const { buildGameLog } = await import("@/lib/game-log");
    const result = await getTeam(LEAGUE, 1, SEASON);
    const log = buildGameLog(result!.team, result!.league.teams);
    expect(log.rows.map((row) => row.opponentName)).toEqual(["Bravo", "Bravo"]);
    expect(log.rows[0].opponentScore).toBe(95);
    expect(log.rows[1].opponentScore).toBe(90);
  });

  it("does not load opponent rosters on the team fast path", async () => {
    const { getTeam } = await import("@/lib/data");
    const result = await getTeam(LEAGUE, 1, SEASON);
    const opponents = result!.league.teams.filter((t) => t.team_id !== 1);
    expect(opponents).toHaveLength(1);
    expect(opponents[0].roster).toEqual([]);
    // players[] stays empty — the point of the 2.2 split (AUDIT #16).
    expect(result!.league.players).toEqual([]);
  });

  it("returns null for a team id that is not in the season", async () => {
    const { getTeam } = await import("@/lib/data");
    expect(await getTeam(LEAGUE, 99, SEASON)).toBeNull();
  });
});
