/**
 * Recap LLM cost guardrails (roadmap 7.15).
 *
 * Hub-native `{SJ_HUB_DIR}/recap_usage.json` — daily UTC call cap plus a
 * per league-season-period rewrite cap. Template / fixture writes do not count.
 *
 * Slots are reserved under a process mutex + exclusive lock file *before* the
 * LLM runs so a double-click cannot bypass the cap, and a later write failure
 * cannot leave spend uncounted.
 */

import { promises as fs } from "fs";
import path from "path";

import { hubDataRoot } from "@/lib/hub-paths";

export const DEFAULT_RECAP_DAILY_LIMIT = 12;
export const DEFAULT_RECAP_PERIOD_LIMIT = 2;
const KEEP_DAILY_DAYS = 14;
const LOCK_STALE_MS = 30_000;
const LOCK_ATTEMPTS = 40;

export type RecapUsageFile = {
  schema_version: 1;
  daily: Record<string, { calls: number }>;
  periods: Record<string, number>;
};

export type RecapUsageLimits = {
  daily: number;
  period: number;
};

export type RecapReserveResult =
  | { ok: true; usage: RecapUsageFile }
  | { ok: false; error: string };

export function recapUsagePath(root = hubDataRoot()): string {
  return path.join(root, "recap_usage.json");
}

export function recapUsageLockPath(root = hubDataRoot()): string {
  return path.join(root, "recap_usage.lock");
}

export function recapPeriodUsageKey(
  leagueId: string,
  season: number,
  period: number,
): string {
  return `${leagueId}/${season}/${period}`;
}

export function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function parseLimit(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return n;
}

export function recapUsageLimitsFromEnv(
  env: Record<string, string | undefined> = process.env,
): RecapUsageLimits {
  return {
    daily: parseLimit(env.SJ_RECAP_DAILY_LIMIT, DEFAULT_RECAP_DAILY_LIMIT),
    period: parseLimit(env.SJ_RECAP_PERIOD_LIMIT, DEFAULT_RECAP_PERIOD_LIMIT),
  };
}

function emptyUsage(): RecapUsageFile {
  return { schema_version: 1, daily: {}, periods: {} };
}

export async function readRecapUsage(
  root = hubDataRoot(),
): Promise<RecapUsageFile> {
  try {
    const raw = await fs.readFile(recapUsagePath(root), "utf8");
    const parsed = JSON.parse(raw) as RecapUsageFile;
    return {
      schema_version: 1,
      daily:
        parsed.daily && typeof parsed.daily === "object" ? parsed.daily : {},
      periods:
        parsed.periods && typeof parsed.periods === "object"
          ? parsed.periods
          : {},
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyUsage();
    throw err;
  }
}

async function writeRecapUsage(
  file: RecapUsageFile,
  root = hubDataRoot(),
): Promise<void> {
  const filePath = recapUsagePath(root);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

function pruneDaily(
  daily: Record<string, { calls: number }>,
  now: Date,
): Record<string, { calls: number }> {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCDate(cutoff.getUTCDate() - KEEP_DAILY_DAYS);
  const cutoffKey = utcDayKey(cutoff);
  const next: Record<string, { calls: number }> = {};
  for (const [day, row] of Object.entries(daily)) {
    if (day >= cutoffKey && row && typeof row.calls === "number") {
      next[day] = { calls: row.calls };
    }
  }
  return next;
}

export function recapBudgetError(
  usage: RecapUsageFile,
  leagueId: string,
  season: number,
  period: number,
  now: Date,
  limits: RecapUsageLimits,
): string | null {
  const day = utcDayKey(now);
  const dailyCalls = usage.daily[day]?.calls ?? 0;
  if (dailyCalls >= limits.daily) {
    return `Recap writer hit today's cap (${limits.daily} LLM calls UTC). Try again tomorrow or raise SJ_RECAP_DAILY_LIMIT.`;
  }
  const key = recapPeriodUsageKey(leagueId, season, period);
  const periodCalls = usage.periods[key] ?? 0;
  if (periodCalls >= limits.period) {
    const noun = limits.period === 1 ? "AI recap" : "AI recaps";
    return `This week already has ${limits.period} ${noun}. Rewrite is capped so a loop cannot run up the OpenAI bill.`;
  }
  return null;
}

function incrementUsage(
  usage: RecapUsageFile,
  leagueId: string,
  season: number,
  period: number,
  now: Date,
): RecapUsageFile {
  const day = utcDayKey(now);
  const daily = pruneDaily(usage.daily, now);
  daily[day] = { calls: (daily[day]?.calls ?? 0) + 1 };
  const key = recapPeriodUsageKey(leagueId, season, period);
  return {
    schema_version: 1,
    daily,
    periods: { ...usage.periods, [key]: (usage.periods[key] ?? 0) + 1 },
  };
}

let usageChain: Promise<unknown> = Promise.resolve();

function serializeUsage<T>(fn: () => Promise<T>): Promise<T> {
  const run = usageChain.then(fn, fn);
  usageChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRecapUsageLock<T>(
  root: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = recapUsageLockPath(root);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(`${process.pid}\n${Date.now()}\n`);
        return await fn();
      } finally {
        await handle.close();
        await fs.unlink(lockPath).catch(() => undefined);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          await fs.unlink(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      await sleep(20 + Math.random() * 40);
    }
  }
  throw new Error("recap usage lock timed out");
}

async function mutateUsage<T>(
  root: string,
  fn: (usage: RecapUsageFile) => Promise<T> | T,
): Promise<T> {
  return serializeUsage(() =>
    withRecapUsageLock(root, async () => fn(await readRecapUsage(root))),
  );
}

/** Check the cap and increment in one locked step. Fail-closed: the slot stays spent even if the LLM later errors. */
export async function reserveRecapLlmCall(
  leagueId: string,
  season: number,
  period: number,
  now: Date,
  limits: RecapUsageLimits,
  root = hubDataRoot(),
): Promise<RecapReserveResult> {
  return mutateUsage(root, async (usage) => {
    const error = recapBudgetError(usage, leagueId, season, period, now, limits);
    if (error) return { ok: false as const, error };
    const next = incrementUsage(usage, leagueId, season, period, now);
    await writeRecapUsage(next, root);
    return { ok: true as const, usage: next };
  });
}

export async function recordRecapLlmCall(
  leagueId: string,
  season: number,
  period: number,
  now = new Date(),
  root = hubDataRoot(),
): Promise<RecapUsageFile> {
  return mutateUsage(root, async (usage) => {
    const next = incrementUsage(usage, leagueId, season, period, now);
    await writeRecapUsage(next, root);
    return next;
  });
}
