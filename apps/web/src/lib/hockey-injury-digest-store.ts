/**
 * Idempotency sidecar for the hockey injury Discord post (HOCKEY-PORT.md H6)
 * under SJ_HUB_DIR: `{hub}/{leagueId}/{season}/injury_digest.json`.
 * Stores the injury-log event ids already posted.
 */

import { promises as fs } from "fs";
import path from "path";

import { hubDataRoot } from "@/lib/hub-paths";

export type InjuryDigestFile = {
  schema_version: 1;
  league_id: string;
  season: number;
  sent: string[];
  updated_at: string;
};

/** Plenty for a season of transitions; oldest ids fall off first. */
const MAX_IDS = 2000;

function digestPath(leagueId: string, season: number): string {
  return path.join(hubDataRoot(), leagueId, String(season), "injury_digest.json");
}

async function atomicWrite(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

export async function readInjuryDigest(leagueId: string, season: number): Promise<InjuryDigestFile> {
  const empty: InjuryDigestFile = {
    schema_version: 1,
    league_id: leagueId,
    season,
    sent: [],
    updated_at: new Date().toISOString(),
  };
  try {
    const parsed = JSON.parse(await fs.readFile(digestPath(leagueId, season), "utf8")) as InjuryDigestFile;
    return { ...empty, sent: Array.isArray(parsed.sent) ? parsed.sent : [], updated_at: parsed.updated_at || empty.updated_at };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return empty;
    throw err;
  }
}

export async function markInjuriesSent(leagueId: string, season: number, ids: string[]): Promise<InjuryDigestFile> {
  const current = await readInjuryDigest(leagueId, season);
  const sent = [...current.sent];
  for (const id of ids) if (!sent.includes(id)) sent.push(id);
  const next: InjuryDigestFile = {
    schema_version: 1,
    league_id: leagueId,
    season,
    sent: sent.slice(-MAX_IDS),
    updated_at: new Date().toISOString(),
  };
  await atomicWrite(digestPath(leagueId, season), next);
  return next;
}
