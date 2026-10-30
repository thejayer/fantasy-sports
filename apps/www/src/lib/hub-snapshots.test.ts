import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listEspnLeagues, readSeason } from "./hub-snapshots";

let dir: string;
const was = process.env.SJ_HUB_DIR;
const wasSource = process.env.SJ_DATA_SOURCE;

async function put(rel: string, value: unknown) {
  const file = path.join(dir, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "hub-"));
  process.env.SJ_HUB_DIR = dir;
  delete process.env.SJ_DATA_SOURCE;
});
afterEach(async () => {
  if (was === undefined) delete process.env.SJ_HUB_DIR;
  else process.env.SJ_HUB_DIR = was;
  if (wasSource !== undefined) process.env.SJ_DATA_SOURCE = wasSource;
  await rm(dir, { recursive: true, force: true });
});

const index = {
  leagues: [
    { league_id: "football-main", name: "Football", season: 2026, path: "football-main/2026/manifest.json", espn_league_id: 1 },
    { league_id: "golf-main", name: "Golf", season: 2026, path: "golf-main/2026.json", espn_league_id: null },
    { league_id: "old-league", name: "Old", season: 2026, path: "old-league/2026.json", espn_league_id: 2 },
    { league_id: "../evil", name: "Bad", season: 2026, path: "x.json", espn_league_id: 3 },
    { league_id: "sneaky", name: "Sneaky", season: 2026, path: "../secret.json", espn_league_id: 4 },
  ],
};

describe("listEspnLeagues", () => {
  it("lists ESPN leagues only, drops unsafe ids and paths, and never returns ESPN ids", async () => {
    await put("index.json", index);
    const out = await listEspnLeagues();
    expect(out?.map((l) => l.leagueId)).toEqual(["football-main", "old-league"]);
    expect(JSON.stringify(out)).not.toContain("espn");
  });

  it("is null when the hub has no index", async () => {
    expect(await listEspnLeagues()).toBeNull();
  });
});

describe("readSeason", () => {
  it("reads the split layout: teams from standings, results from matchups", async () => {
    await put("index.json", index);
    await put("football-main/2026/manifest.json", {
      files: { standings: "standings.json", matchups: "matchups.json" },
    });
    await put("football-main/2026/standings.json", {
      teams: [
        { team_id: 1, name: "Alpha", abbrev: "ALP", owners: ["Pat Jay"] },
        { team_id: 2, name: "Beta", abbrev: "BET", owners: ["owner@example.com"] },
      ],
    });
    await put("football-main/2026/matchups.json", {
      teams: {
        "1": { schedule: [2, 1, 2, 2], outcomes: ["W", "W", "L", "U"], scores: [] },
        "2": { schedule: [1, 2, 1, 1], outcomes: ["L", "W", "W", "U"], scores: [] },
      },
    });
    const [league] = (await listEspnLeagues())!;
    const season = await readSeason(league);
    expect(season?.teams).toEqual([
      { team: "1", label: "Alpha", owner: "Pat Jay" },
      { team: "2", label: "Beta", owner: "" }, // an email is never shown
    ]);
    const one = season!.results.filter((r) => r.team === "1");
    // Period 2 is a bye (own id in the schedule): never a win.
    expect(one.map((r) => r.outcome)).toEqual(["W", "U", "L", "U"]);
    expect(one.map((r) => r.period)).toEqual([1, 2, 3, 4]);
  });

  it("reads the legacy single-file layout", async () => {
    await put("index.json", index);
    await put("old-league/2026.json", {
      teams: [{ team_id: 7, name: "Gamma", owners: [], schedule: [8], outcomes: ["T"] }],
    });
    const league = (await listEspnLeagues())!.find((l) => l.leagueId === "old-league")!;
    const season = await readSeason(league);
    expect(season?.teams[0]).toEqual({ team: "7", label: "Gamma", owner: "" });
    expect(season?.results).toEqual([{ team: "7", period: 1, outcome: "T" }]);
  });

  it("is null when the season files are missing or broken", async () => {
    await put("index.json", index);
    await put("old-league/2026.json", { nope: true });
    const leagues = (await listEspnLeagues())!;
    expect(await readSeason(leagues[0])).toBeNull();
    expect(await readSeason(leagues[1])).toBeNull();
  });
});
