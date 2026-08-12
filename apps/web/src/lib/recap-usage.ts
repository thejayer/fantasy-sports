/**
 * Recap LLM cost guardrails (roadmap 7.15).
 *
 * Hub-native `{SJ_HUB_DIR}/recap_usage.json` — daily UTC call cap plus a
 * per league-season-period rewrite cap. Template / fixture writes do not count.
 */

import { promises as fs } from "fs";
import path from "path";

import { hubDataRoot } from "@/lib/hub-paths";

export const DEFAULT_RECAP_DAILY_LIMIT = 12;
export const DEFAULT_RECAP_PERIOD_LIMIT = 2;
const KEEP_DAILY_DAYS = 14;

export type RecapUsageFile = {
  schema_version: 1;
  daily: Record<string, { calls: number }>;
  periods: Record<string, number>;
};

export type RecapUsageLimits = {
  daily: number;
  period: number;
};

export function recapUsagePath(root = hubDataRoot()): string {
  return path.join(root, "recap_usage.json");
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

export async function recordRecapLlmCall(
  leagueId: string,
  season: number,
  period: number,
  now = new Date(),
  root = hubDataRoot(),
): Promise<RecapUsageFile> {
  const usage = await readRecapUsage(root);
  const day = utcDayKey(now);
  usage.daily = pruneDaily(usage.daily, now);
  usage.daily[day] = { calls: (usage.daily[day]?.calls ?? 0) + 1 };
  const key = recapPeriodUsageKey(leagueId, season, period);
  usage.periods[key] = (usage.periods[key] ?? 0) + 1;
  await writeRecapUsage(usage, root);
  return usage;
}
