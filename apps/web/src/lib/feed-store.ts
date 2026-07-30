/**
 * Server-only league feed persistence (`feed.json`).
 * Uncached — do not route through getLeagueSnapshot / readJson.
 */

import { promises as fs } from "fs";
import path from "path";

import { emptyFeed, type LeagueFeed } from "@/lib/feed";
import { hubDataRoot } from "@/lib/hub-paths";

export function feedPath(leagueId: string, season: number): string {
  return path.join(hubDataRoot(), leagueId, String(season), "feed.json");
}

async function atomicWrite(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

export async function readFeed(
  leagueId: string,
  season: number,
): Promise<LeagueFeed> {
  const filePath = feedPath(leagueId, season);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const doc = JSON.parse(raw) as LeagueFeed;
    if (doc.league_id !== leagueId || doc.season !== season) {
      // Path is authoritative if a hand-edited file drifted.
      return {
        ...doc,
        league_id: leagueId,
        season,
        comments: doc.comments ?? [],
        reactions: doc.reactions ?? [],
        polls: doc.polls ?? [],
      };
    }
    return {
      ...doc,
      comments: doc.comments ?? [],
      reactions: doc.reactions ?? [],
      polls: doc.polls ?? [],
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyFeed(leagueId, season);
    throw err;
  }
}

export async function writeFeed(feed: LeagueFeed): Promise<void> {
  await atomicWrite(feedPath(feed.league_id, feed.season), feed);
}

/**
 * Compare-and-swap on revision. Returns the on-disk document when the
 * expected revision does not match (caller should 409 with it).
 */
export async function saveFeedIfRevision(
  expectedRevision: number,
  next: LeagueFeed,
): Promise<
  { ok: true; feed: LeagueFeed } | { ok: false; feed: LeagueFeed }
> {
  const current = await readFeed(next.league_id, next.season);
  if (current.revision !== expectedRevision) {
    return { ok: false, feed: current };
  }
  await writeFeed(next);
  return { ok: true, feed: next };
}
