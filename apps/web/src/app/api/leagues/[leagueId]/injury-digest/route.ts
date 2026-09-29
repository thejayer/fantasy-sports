/**
 * Hockey injury news → Discord (HOCKEY-PORT.md H6).
 *
 * Admin-triggered, like the golf lineup reminders. Off unless the hub runs
 * with `SJ_HOCKEY_INJURY_DISCORD=1` (and `SJ_DISCORD_WEBHOOK_URL`). Posts
 * rostered players' injury transitions from the last 3 days that were not
 * posted before; ids are tracked in `injury_digest.json` under SJ_HUB_DIR.
 */

import { NextResponse } from "next/server";

import { getHockeyInjuryLog, getLeagueSnapshot } from "@/lib/data";
import { deliverDigestToDiscord } from "@/lib/digest-transport";
import { enforceFeedModerate } from "@/lib/franchise-acl";
import { formatInjuryDigest, injuryDiscordEnabled, injuryNews } from "@/lib/hockey-alerts";
import { markInjuriesSent, readInjuryDigest } from "@/lib/hockey-injury-digest-store";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ leagueId: string }> };

/** Only fresh news goes out; older transitions stay on the hub. */
const DIGEST_DAYS = 3;

export async function POST(request: Request, { params }: Props) {
  await requireSession();
  const { leagueId } = await params;
  const denied = await enforceFeedModerate(leagueId);
  if (denied) return denied;
  if (!injuryDiscordEnabled()) {
    return NextResponse.json(
      { error: "Injury posts to Discord are off (set SJ_HOCKEY_INJURY_DISCORD=1 on the hub)." },
      { status: 409 },
    );
  }

  let body: { season?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const season = Number(body.season);
  if (!Number.isInteger(season) || season < 1) {
    return NextResponse.json({ error: "season is required" }, { status: 400 });
  }
  const league = await getLeagueSnapshot(leagueId, season);
  if (!league || league.sport !== "hockey") {
    return NextResponse.json({ error: "hockey league not found" }, { status: 404 });
  }

  const log = await getHockeyInjuryLog(leagueId, season);
  const file = await readInjuryDigest(leagueId, season);
  const pending = injuryNews(log, league, { days: DIGEST_DAYS })
    .filter((n) => !file.sent.includes(n.id))
    .reverse(); // oldest first in the message
  if (!pending.length) {
    return NextResponse.json({ sent: 0, delivery: { ok: true, channel: "discord", skipped: true } });
  }

  const delivery = await deliverDigestToDiscord(formatInjuryDigest(league, pending));
  if (!delivery.ok) {
    return NextResponse.json(
      { error: delivery.error, delivery },
      { status: delivery.channel === "none" ? 503 : 502 },
    );
  }
  await markInjuriesSent(leagueId, season, pending.map((n) => n.id));
  return NextResponse.json({ sent: pending.length, delivery });
}
