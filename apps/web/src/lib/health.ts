/**
 * Snapshot freshness for the public `/api/health` probe.
 *
 * Intentionally separate from `lib/data.ts`: that module gates every read
 * behind a session check, and health must stay reachable without a cookie so
 * uptime checks and Cloud Monitoring can call it.
 */

import { promises as fs } from "fs";
import path from "path";

export type HealthLeague = {
  league_id: string;
  name: string;
  sport: string;
  season: number;
  synced_at: string | null;
  age_seconds: number | null;
  stale: boolean;
};

export type HealthReport = {
  ok: boolean;
  status: "ok" | "stale" | "empty";
  checked_at: string;
  stale_after_seconds: number;
  source: string | null;
  league_count: number;
  stale_count: number;
  oldest_age_seconds: number | null;
  leagues: HealthLeague[];
};

const DEFAULT_STALE_AFTER_SECONDS = 2 * 60 * 60; // two hours — four missed 30m syncs

function dataRoots(): string[] {
  const roots = [
    process.env.SJ_DATA_DIR,
    path.resolve(process.cwd(), "../../data/sj"),
    path.resolve(process.cwd(), "../../fixtures/sj"),
    path.resolve(process.cwd(), "fixtures/sj"),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(roots)];
}

type IndexFile = {
  generated_at?: string;
  leagues?: Array<{
    league_id: string;
    name: string;
    sport: string;
    season: number;
    synced_at?: string;
  }>;
};

async function readIndex(
  root: string,
): Promise<{ index: IndexFile; source: string } | null> {
  const filePath = path.join(root, "index.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const index = JSON.parse(raw) as IndexFile;
    if (!index?.leagues?.length) {
      return null;
    }
    return { index, source: root };
  } catch {
    return null;
  }
}

/** Latest season per league_id, same selection rule as the hub home page. */
function latestPerLeague(index: IndexFile): NonNullable<IndexFile["leagues"]> {
  const latest = new Map<string, NonNullable<IndexFile["leagues"]>[number]>();
  for (const item of index.leagues ?? []) {
    const prev = latest.get(item.league_id);
    if (!prev || item.season > prev.season) {
      latest.set(item.league_id, item);
    }
  }
  return [...latest.values()].sort(
    (a, b) => a.sport.localeCompare(b.sport) || a.name.localeCompare(b.name),
  );
}

function ageSeconds(syncedAt: string | undefined, nowMs: number): number | null {
  if (!syncedAt) {
    return null;
  }
  const then = Date.parse(syncedAt);
  if (Number.isNaN(then)) {
    return null;
  }
  return Math.max(0, Math.floor((nowMs - then) / 1000));
}

export function staleAfterSeconds(): number {
  const raw = process.env.SJ_HEALTH_STALE_SECONDS;
  if (raw === undefined || raw === "") {
    return DEFAULT_STALE_AFTER_SECONDS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STALE_AFTER_SECONDS;
}

/**
 * Build a health report from whatever snapshot store is visible to the process.
 * Pass `roots` in tests to avoid falling through to repo fixtures / local data.
 */
export async function buildHealthReport(
  nowMs: number = Date.now(),
  roots: string[] = dataRoots(),
): Promise<HealthReport> {
  const threshold = staleAfterSeconds();
  const checkedAt = new Date(nowMs).toISOString();

  let loaded: { index: IndexFile; source: string } | null = null;
  for (const root of roots) {
    loaded = await readIndex(root);
    if (loaded) {
      break;
    }
  }

  if (!loaded) {
    return {
      ok: false,
      status: "empty",
      checked_at: checkedAt,
      stale_after_seconds: threshold,
      source: null,
      league_count: 0,
      stale_count: 0,
      oldest_age_seconds: null,
      leagues: [],
    };
  }

  const leagues: HealthLeague[] = latestPerLeague(loaded.index).map((item) => {
    const age = ageSeconds(item.synced_at, nowMs);
    const stale = age === null || age > threshold;
    return {
      league_id: item.league_id,
      name: item.name,
      sport: item.sport,
      season: item.season,
      synced_at: item.synced_at ?? null,
      age_seconds: age,
      stale,
    };
  });

  const staleCount = leagues.filter((league) => league.stale).length;
  const ages = leagues
    .map((league) => league.age_seconds)
    .filter((age): age is number => age !== null);
  const oldest = ages.length ? Math.max(...ages) : null;
  const status = staleCount > 0 ? "stale" : "ok";

  return {
    ok: status === "ok",
    status,
    checked_at: checkedAt,
    stale_after_seconds: threshold,
    source: loaded.source,
    league_count: leagues.length,
    stale_count: staleCount,
    oldest_age_seconds: oldest,
    leagues,
  };
}
