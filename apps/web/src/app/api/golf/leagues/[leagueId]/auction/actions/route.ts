import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { SJ_SNAPSHOTS_CACHE_TAG } from "@/lib/cache-tags";
import { getLeagueSnapshot } from "@/lib/data";
import { finalizeAuctionRoom } from "@/lib/golf-auction-finalize";
import { markFinalized, nominatePlayer, passBid, placeBid, startAuctionRoom } from "@/lib/golf-auction-room";
import { readAuctionRoom, updateAuctionRoom } from "@/lib/golf-auction-store";
import { enforceAuctionControl, enforceAuctionFinalize, enforceTeamAction } from "@/lib/franchise-acl";
import { requireSession } from "@/lib/session";
import { golfWritesEnabled, GOLF_WRITES_PAUSED } from "@/lib/golf-rollout-gate";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ leagueId: string }> };
type ActionBody = { action?: string; season?: number; revision?: number; team_id?: number; player_id?: number; amount?: number };

export async function POST(request: Request, { params }: Props) {
  await requireSession();
  if (!golfWritesEnabled()) return NextResponse.json({ error: GOLF_WRITES_PAUSED, code: "GOLF_WRITES_PAUSED" }, { status: 503 });
  const { leagueId } = await params;
  let body: ActionBody;
  try { body = await request.json() as ActionBody; }
  catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const action = String(body.action ?? "");
  const season = Number(body.season);
  const revision = Number(body.revision);
  const teamId = Number(body.team_id);
  const playerId = Number(body.player_id);
  const amount = Number(body.amount);
  if (!Number.isInteger(season) || !Number.isInteger(revision)) {
    return NextResponse.json({ error: "season and revision are required" }, { status: 400 });
  }
  if (!["start", "nominate", "bid", "pass", "finalize"].includes(action)) {
    return NextResponse.json({ error: "action must be start|nominate|bid|pass|finalize" }, { status: 400 });
  }
  if (["nominate", "bid", "pass"].includes(action) && !Number.isInteger(teamId)) {
    return NextResponse.json({ error: "team_id is required" }, { status: 400 });
  }
  if (action === "nominate" && !Number.isInteger(playerId)) {
    return NextResponse.json({ error: "player_id is required" }, { status: 400 });
  }
  if (action === "bid" && !Number.isInteger(amount)) {
    return NextResponse.json({ error: "amount is required" }, { status: 400 });
  }
  // Async authorization must not be replayed by a storage CAS retry.
  const denied = action === "start" ? await enforceAuctionControl(leagueId)
    : action === "finalize" ? await enforceAuctionFinalize(leagueId)
    : await enforceTeamAction(leagueId, teamId);
  if (denied) return denied;

  try {
    if (action === "finalize") {
      const room = await readAuctionRoom(leagueId, season);
      if (!room) return NextResponse.json({ error: "auction room not found" }, { status: 404 });
      if (room.revision !== revision) return NextResponse.json({ error: "revision conflict", room }, { status: 409 });
      if (room.phase !== "complete") return NextResponse.json({ error: `cannot finalize from phase ${room.phase}`, room }, { status: 400 });
      const league = await getLeagueSnapshot(leagueId, season);
      if (!league) return NextResponse.json({ error: "golf league not found" }, { status: 404 });
      // Repeating an interrupted finalize preserves accepted lineup submissions.
      await finalizeAuctionRoom(room, league);
    }
    const response = await updateAuctionRoom<NextResponse>(leagueId, season, room => {
      if (!room) return { result: NextResponse.json({ error: "auction room not found" }, { status: 404 }) };
      if (room.revision !== revision) {
        return { result: NextResponse.json({ error: "revision conflict", room }, { status: 409 }) };
      }
      try {
        const now = new Date();
        const next = action === "start" ? startAuctionRoom(room, now)
          : action === "nominate" ? nominatePlayer(room, teamId, playerId, now)
          : action === "bid" ? placeBid(room, teamId, amount, now)
          : action === "pass" ? passBid(room, teamId, now)
          : markFinalized(room, now);
        return { room: next, result: NextResponse.json({ room: next, ...(action === "finalize" ? { finalized: true } : {}) }) };
      } catch (error) {
        return { result: NextResponse.json({ error: error instanceof Error ? error.message : "action failed", room }, { status: 400 }) };
      }
    });
    if (action === "finalize" && response.ok) revalidateTag(SJ_SNAPSHOTS_CACHE_TAG, "max");
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "storage unavailable" }, { status: 503 });
  }
}
