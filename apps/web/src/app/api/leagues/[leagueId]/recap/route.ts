/**
 * Admin POST to write a weekly recap column (roadmap 7.15).
 * GET is the league page — this route never runs on render.
 */

import { NextResponse } from "next/server";

import { getLeagueSnapshot } from "@/lib/data";
import { enforceFeedModerate } from "@/lib/franchise-acl";
import { generateAndStoreRecap } from "@/lib/recap-generate";
import { recapSport } from "@/lib/recap";
import { requireSession, devBypassEnabled } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Props = { params: Promise<{ leagueId: string }> };

export async function POST(request: Request, { params }: Props) {
  await requireSession();
  const { leagueId } = await params;
  const denied = await enforceFeedModerate(leagueId);
  if (denied) return denied;

  let body: { season?: number; period?: number } = {};
  try {
    body = (await request.json()) as { season?: number; period?: number };
  } catch {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }
  const season = Number(body.season);
  const period = Number(body.period);
  if (!Number.isInteger(season) || !Number.isInteger(period) || period < 1) {
    return NextResponse.json(
      { error: "season and period are required" },
      { status: 400 },
    );
  }

  const league = await getLeagueSnapshot(leagueId, season);
  if (!league) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }
  if (!recapSport(league.sport)) {
    return NextResponse.json(
      { error: "Recaps are football and baseball only" },
      { status: 400 },
    );
  }

  const result = await generateAndStoreRecap(league, period, {
    allowTemplate: devBypassEnabled(),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, article: result.article });
}
