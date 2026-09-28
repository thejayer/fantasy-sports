/**
 * Server-only auction room persistence (`auction_room.json`).
 * Uncached — do not route through getLeagueSnapshot.
 */

import { promises as fs } from "fs";
import path from "path";

import {
  createAuctionRoom,
  tickAuctionRoom,
  type AuctionRoom,
} from "@/lib/golf-auction-room";
import {
  DEFAULT_GOLF_SETTINGS,
  GOLF_STARTERS,
  parseGolfSettings,
} from "@/lib/golf";
import type { LeagueSnapshot } from "@/lib/data";

import { hubDataRoot } from "@/lib/hub-paths";

function writableDataRoot(): string {
  return hubDataRoot();
}

export function auctionRoomPath(leagueId: string, season: number): string {
  return path.join(
    writableDataRoot(),
    leagueId,
    String(season),
    "auction_room.json",
  );
}

async function atomicWrite(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

export async function readAuctionRoom(
  leagueId: string,
  season: number,
): Promise<AuctionRoom | null> {
  const filePath = auctionRoomPath(leagueId, season);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const room = JSON.parse(raw) as AuctionRoom;
    return tickAuctionRoom(room, new Date());
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

export async function writeAuctionRoom(room: AuctionRoom): Promise<void> {
  await atomicWrite(auctionRoomPath(room.league_id, room.season), room);
}

/** Create lobby room from a league snapshot (auction leagues only). */
export function roomFromLeagueSnapshot(
  league: LeagueSnapshot,
  opts?: { bid_window_ms?: number; bid_hard_cap_ms?: number },
): AuctionRoom {
  if (league.sport !== "golf") {
    throw new Error("auction room is golf-only");
  }
  const golf = parseGolfSettings(league.settings) ?? DEFAULT_GOLF_SETTINGS;
  if (golf.draft.style !== "auction") {
    throw new Error("league draft style must be auction");
  }
  if (league.draft?.length) {
    throw new Error("league already has a completed draft");
  }
  return createAuctionRoom({
    league_id: league.league_id,
    season: league.season,
    team_ids: league.teams.map((t) => t.team_id),
    team_names: Object.fromEntries(
      league.teams.map((t) => [String(t.team_id), t.name]),
    ),
    budget: golf.draft.budget,
    starters: golf.roster.starters || GOLF_STARTERS,
    bench: golf.roster.bench,
    bid_window_ms: opts?.bid_window_ms,
    bid_hard_cap_ms: opts?.bid_hard_cap_ms,
  });
}

export async function saveAuctionRoomIfNewer(
  expectedRevision: number,
  next: AuctionRoom,
): Promise<{ ok: true; room: AuctionRoom } | { ok: false; room: AuctionRoom }> {
  const current = await readAuctionRoom(next.league_id, next.season);
  if (current && current.revision !== expectedRevision) {
    return { ok: false, room: current };
  }
  await writeAuctionRoom(next);
  return { ok: true, room: next };
}
