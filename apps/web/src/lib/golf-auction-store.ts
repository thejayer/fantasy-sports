/**
 * Server-only auction room persistence (`auction_room.json`).
 * Uncached — do not route through getLeagueSnapshot.
 */

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
import { mutateGolfDocument } from "@/lib/golf-document-store";

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

/** Timer transitions and actions share the same conditional document write. */
export async function updateAuctionRoom<R>(
  leagueId: string,
  season: number,
  change: (room: AuctionRoom | null) => { room?: AuctionRoom; result: R },
): Promise<R> {
  return mutateGolfDocument<AuctionRoom, R>(`${leagueId}/${season}/auction_room.json`, current => {
    const ticked = current ? tickAuctionRoom(current, new Date()) : null;
    const next = change(ticked);
    return { value: next.room ?? (ticked !== current ? ticked ?? undefined : undefined), result: next.result };
  });
}

export async function readAuctionRoom(leagueId: string, season: number): Promise<AuctionRoom | null> {
  return updateAuctionRoom(leagueId, season, room => ({ result: room }));
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
  return updateAuctionRoom<{ ok: true; room: AuctionRoom } | { ok: false; room: AuctionRoom }>(next.league_id, next.season, current => {
    if (current && current.revision !== expectedRevision) {
      return { result: { ok: false, room: current } as const };
    }
    return { room: next, result: { ok: true, room: next } as const };
  });
}
