/**
 * Hub-native weekly recap files.
 * `{league}/{season}/recaps/{period}.json` — uncached, like feed.json.
 * Reads search hub root first, then snapshot/fixture roots.
 */

import { promises as fs } from "fs";
import path from "path";

import { dataRoots, hubDataRoot } from "@/lib/hub-paths";
import { parseRecapArticle, type RecapArticle } from "@/lib/recap";

export function recapFilePath(
  root: string,
  leagueId: string,
  season: number,
  period: number,
): string {
  return path.join(root, leagueId, String(season), "recaps", `${period}.json`);
}

async function atomicWrite(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

export async function readRecap(
  leagueId: string,
  season: number,
  period: number,
): Promise<RecapArticle | null> {
  for (const root of dataRoots()) {
    const filePath = recapFilePath(root, leagueId, season, period);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = parseRecapArticle(JSON.parse(raw));
      if (
        parsed &&
        parsed.league_id === leagueId &&
        parsed.season === season &&
        parsed.period === period
      ) {
        return parsed;
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw err;
    }
  }
  return null;
}

export async function listRecapPeriods(
  leagueId: string,
  season: number,
): Promise<number[]> {
  const found = new Set<number>();
  for (const root of dataRoots()) {
    const dir = path.join(root, leagueId, String(season), "recaps");
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw err;
    }
    for (const name of names) {
      const match = /^(\d+)\.json$/.exec(name);
      if (!match) continue;
      found.add(Number(match[1]));
    }
  }
  return [...found].sort((a, b) => a - b);
}

export async function writeRecap(article: RecapArticle): Promise<void> {
  const filePath = recapFilePath(
    hubDataRoot(),
    article.league_id,
    article.season,
    article.period,
  );
  await atomicWrite(filePath, article);
}
