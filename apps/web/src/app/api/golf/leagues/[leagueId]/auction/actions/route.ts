import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { SJ_SNAPSHOTS_CACHE_TAG } from "@/lib/cache-tags";
import { getLeagueSnapshot } from "@/lib/data";
import { finalizeAuctionRoom } from "@/lib/golf-auction-finalize";
import {
  markFinalized,
  nominatePlayer,
  passBid,
  placeBid,
  startAuctionRoom,
  tickAuctionRoom,
  type AuctionRoom,
} from "@/lib/golf-auction-room";
import {
  readAuctionRoom,
  writeAuctionRoom,
} from "@/lib/golf-auction-store";
import {
  enforceAuctionControl,
  enforceAuctionFinalize,
  enforceTeamAction,
} from "@/lib/franchise-acl";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ leagueId: string }> };

type ActionBody = {
  action?: string;
  season?: number;
  revision?: number;
  team_id?: number;
  player_id?: number;
  amount?: number;
};

export async function POST(request: Request, { params }: Props) {
  await requireSession();
  const { leagueId } = await params;

  let body: ActionBody;
  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  const season = Number(body.season);
  const revision = Number(body.revision);
  if (!Number.isInteger(season) || !Number.isInteger(revision)) {
    return NextResponse.json(
      { error: "season and revision are required" },
      { status: 400 },
    );
  }

  let room = await readAuctionRoom(leagueId, season);
  if (!room) {
    return NextResponse.json({ error: "auction room not found" }, { status: 404 });
  }
  room = tickAuctionRoom(room, new Date());
  if (room.revision !== revision) {
    await writeAuctionRoom(room);
    return NextResponse.json(
      { error: "revision conflict", room },
      { status: 409 },
    );
  }

  try {
    let next: AuctionRoom;
    const now = new Date();
    switch (action) {
      case "start": {
        const denied = await enforceAuctionControl(leagueId);
        if (denied) return denied;
        next = startAuctionRoom(room, now);
        break;
      }
      case "nominate": {
        const teamId = Number(body.team_id);
        const playerId = Number(body.player_id);
        if (!Number.isInteger(teamId) || !Number.isInteger(playerId)) {
          return NextResponse.json(
            { error: "team_id and player_id are required" },
            { status: 400 },
          );
        }
        const denied = await enforceTeamAction(leagueId, teamId);
        if (denied) return denied;
        next = nominatePlayer(room, teamId, playerId, now);
        break;
      }
      case "bid": {
        const teamId = Number(body.team_id);
        const amount = Number(body.amount);
        if (!Number.isInteger(teamId) || !Number.isInteger(amount)) {
          return NextResponse.json(
            { error: "team_id and amount are required" },
            { status: 400 },
          );
        }
        const denied = await enforceTeamAction(leagueId, teamId);
        if (denied) return denied;
        next = placeBid(room, teamId, amount, now);
        break;
      }
      case "pass": {
        const teamId = Number(body.team_id);
        if (!Number.isInteger(teamId)) {
          return NextResponse.json(
            { error: "team_id is required" },
            { status: 400 },
          );
        }
        const denied = await enforceTeamAction(leagueId, teamId);
        if (denied) return denied;
        next = passBid(room, teamId, now);
        break;
      }
      case "finalize": {
        const denied = await enforceAuctionFinalize(leagueId);
        if (denied) return denied;
        const league = await getLeagueSnapshot(leagueId, season);
        if (!league) {
          return NextResponse.json(
            { error: "golf league not found" },
            { status: 404 },
          );
        }
        await finalizeAuctionRoom(room, league);
        next = markFinalized(room, now);
        await writeAuctionRoom(next);
        revalidateTag(SJ_SNAPSHOTS_CACHE_TAG, "max");
        return NextResponse.json({ room: next, finalized: true });
      }
      default:
        return NextResponse.json(
          { error: "action must be start|nominate|bid|pass|finalize" },
          { status: 400 },
        );
    }
    await writeAuctionRoom(next);
    return NextResponse.json({ room: next });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "action failed",
        room,
      },
      { status: 400 },
    );
  }
}
