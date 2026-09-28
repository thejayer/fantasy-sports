import { NextResponse } from "next/server";

import { getLeagueSnapshot } from "@/lib/data";
import {
  readAuctionRoom,
  roomFromLeagueSnapshot,
  writeAuctionRoom,
} from "@/lib/golf-auction-store";
import { enforceAuctionControl } from "@/lib/franchise-acl";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ leagueId: string }> };

function seasonFrom(request: Request, bodySeason?: number): number | null {
  const url = new URL(request.url);
  const q = Number(url.searchParams.get("season"));
  if (Number.isInteger(q) && q > 0) return q;
  if (bodySeason != null && Number.isInteger(bodySeason) && bodySeason > 0) {
    return bodySeason;
  }
  return null;
}

/** GET room (ticks timers). POST creates lobby if missing. */
export async function GET(request: Request, { params }: Props) {
  await requireSession();
  const { leagueId } = await params;
  const season = seasonFrom(request);
  if (season == null) {
    return NextResponse.json({ error: "season is required" }, { status: 400 });
  }
  const room = await readAuctionRoom(leagueId, season);
  if (!room) {
    return NextResponse.json({ error: "auction room not found" }, { status: 404 });
  }
  // Persist timer transitions so all clients see the same phase.
  await writeAuctionRoom(room);
  return NextResponse.json({ room });
}

export async function POST(request: Request, { params }: Props) {
  await requireSession();
  const { leagueId } = await params;
  const denied = await enforceAuctionControl(leagueId);
  if (denied) return denied;
  let body: {
    season?: number;
    bid_window_ms?: number;
    bid_hard_cap_ms?: number;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const season = seasonFrom(request, body.season);
  if (season == null) {
    return NextResponse.json({ error: "season is required" }, { status: 400 });
  }

  const existing = await readAuctionRoom(leagueId, season);
  if (existing) {
    if (existing.phase === "finalized") {
      return NextResponse.json(
        { error: "auction already finalized", room: existing },
        { status: 409 },
      );
    }
    return NextResponse.json({ room: existing });
  }

  const league = await getLeagueSnapshot(leagueId, season);
  if (!league || league.sport !== "golf") {
    return NextResponse.json({ error: "golf league not found" }, { status: 404 });
  }
  try {
    const room = roomFromLeagueSnapshot(league, {
      bid_window_ms: body.bid_window_ms,
      bid_hard_cap_ms: body.bid_hard_cap_ms,
    });
    await writeAuctionRoom(room);
    return NextResponse.json({ room }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to create room" },
      { status: 400 },
    );
  }
}
