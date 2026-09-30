/**
 * The signed-in member's own hockey player tags / notes (HOCKEY-PORT.md H8).
 * GET returns them; POST `{ espn_id, tags, note }` sets one player's (empty
 * tags + note removes the player). Private: a member only reads / writes
 * their own file.
 */

import { NextResponse } from "next/server";

import { getLeagueIndex } from "@/lib/data";
import { MAX_TAGGED_PLAYERS, sanitizePref, upsertPref } from "@/lib/member-prefs";
import { readMemberPrefs, writeMemberPrefs } from "@/lib/member-prefs-store";
import { requireSession } from "@/lib/session";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ leagueId: string }> };

async function hockeyLeague(leagueId: string): Promise<boolean> {
  const index = await getLeagueIndex();
  return index.some((item) => item.league_id === leagueId && item.sport === "hockey");
}

async function viewerEmail(): Promise<string | null> {
  const viewer = await getViewer();
  return viewer.email;
}

export async function GET(_request: Request, { params }: Props) {
  await requireSession();
  const { leagueId } = await params;
  const email = await viewerEmail();
  if (!email) return NextResponse.json({ error: "sign in to use tags" }, { status: 401 });
  if (!(await hockeyLeague(leagueId))) {
    return NextResponse.json({ error: "hockey league not found" }, { status: 404 });
  }
  return NextResponse.json(await readMemberPrefs(leagueId, email));
}

export async function POST(request: Request, { params }: Props) {
  await requireSession();
  const { leagueId } = await params;
  const email = await viewerEmail();
  if (!email) return NextResponse.json({ error: "sign in to use tags" }, { status: 401 });
  if (!(await hockeyLeague(leagueId))) {
    return NextResponse.json({ error: "hockey league not found" }, { status: 404 });
  }
  let body: { espn_id?: unknown; tags?: unknown; note?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const espnId = String(body.espn_id ?? "");
  if (!/^\d{1,12}$/.test(espnId)) {
    return NextResponse.json({ error: "espn_id is required" }, { status: 400 });
  }
  const current = await readMemberPrefs(leagueId, email);
  const pref = sanitizePref({ tags: body.tags, note: body.note });
  if (pref && !(espnId in current.players) && Object.keys(current.players).length >= MAX_TAGGED_PLAYERS) {
    return NextResponse.json({ error: `at most ${MAX_TAGGED_PLAYERS} tagged players` }, { status: 400 });
  }
  const next = upsertPref(current, espnId, pref);
  await writeMemberPrefs(email, next);
  return NextResponse.json({ ok: true, player: pref, count: Object.keys(next.players).length });
}
