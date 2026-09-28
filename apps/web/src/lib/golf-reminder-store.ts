/**
 * Idempotency sidecar for golf lineup reminders under SJ_HUB_DIR.
 * `{hub}/{leagueId}/{season}/lineup_reminders.json`
 */

import { promises as fs } from "fs";
import path from "path";

import { hubDataRoot } from "@/lib/hub-paths";

export type LineupRemindersFile = {
  schema_version: 1;
  league_id: string;
  season: number;
  delivered: string[];
  updated_at: string;
};

function remindersPath(leagueId: string, season: number): string {
  return path.join(
    hubDataRoot(),
    leagueId,
    String(season),
    "lineup_reminders.json",
  );
}

async function atomicWrite(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

export async function readLineupReminders(
  leagueId: string,
  season: number,
): Promise<LineupRemindersFile> {
  const filePath = remindersPath(leagueId, season);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as LineupRemindersFile;
    return {
      schema_version: 1,
      league_id: leagueId,
      season,
      delivered: Array.isArray(parsed.delivered) ? parsed.delivered : [],
      updated_at: parsed.updated_at || new Date().toISOString(),
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        schema_version: 1,
        league_id: leagueId,
        season,
        delivered: [],
        updated_at: new Date().toISOString(),
      };
    }
    throw err;
  }
}

export function wasReminderDelivered(
  file: LineupRemindersFile,
  deliveryKey: string,
): boolean {
  return file.delivered.includes(deliveryKey);
}

export async function markRemindersDelivered(
  leagueId: string,
  season: number,
  keys: string[],
): Promise<LineupRemindersFile> {
  const current = await readLineupReminders(leagueId, season);
  const nextKeys = [...current.delivered];
  for (const key of keys) {
    if (!nextKeys.includes(key)) nextKeys.push(key);
  }
  const next: LineupRemindersFile = {
    schema_version: 1,
    league_id: leagueId,
    season,
    delivered: nextKeys,
    updated_at: new Date().toISOString(),
  };
  await atomicWrite(remindersPath(leagueId, season), next);
  return next;
}
