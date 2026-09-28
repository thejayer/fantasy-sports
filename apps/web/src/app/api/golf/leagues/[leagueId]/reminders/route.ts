/**
 * Golf lineup reminder delivery (roadmap 7.7).
 * Admin-triggered Discord post for franchises still missing a lineup.
 */

import { NextResponse } from "next/server";

import { getLeagueSnapshot } from "@/lib/data";
import { deliverDigestToDiscord } from "@/lib/digest-transport";
import { enforceFeedModerate } from "@/lib/franchise-acl";
import {
  buildGolfLineupReminders,
  formatGolfReminderMessage,
  REMINDER_WINDOWS_MS,
} from "@/lib/golf-lineup-reminder";
import {
  markRemindersDelivered,
  readLineupReminders,
  wasReminderDelivered,
} from "@/lib/golf-reminder-store";
import { readHubMembers } from "@/lib/hub-members-store";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ leagueId: string }> };

export async function GET(request: Request, { params }: Props) {
  await requireSession();
  const { leagueId } = await params;
  const url = new URL(request.url);
  const season = Number(url.searchParams.get("season"));
  if (!Number.isInteger(season) || season < 1) {
    return NextResponse.json({ error: "season is required" }, { status: 400 });
  }
  const league = await getLeagueSnapshot(leagueId, season);
  if (!league || league.sport !== "golf") {
    return NextResponse.json({ error: "golf league not found" }, { status: 404 });
  }
  const members = await readHubMembers();
  const batch = buildGolfLineupReminders(league, members);
  const delivered = await readLineupReminders(leagueId, season);
  return NextResponse.json({
    batch,
    windows_ms: [...REMINDER_WINDOWS_MS],
    delivered: delivered.delivered,
  });
}

export async function POST(request: Request, { params }: Props) {
  await requireSession();
  const { leagueId } = await params;
  const denied = await enforceFeedModerate(leagueId);
  if (denied) return denied;

  let body: { season?: number; force?: boolean } = {};
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
  if (!league || league.sport !== "golf") {
    return NextResponse.json({ error: "golf league not found" }, { status: 404 });
  }

  const members = await readHubMembers();
  // Admin "Send reminders" pokes every unset/unlocked franchise; scheduled
  // callers can POST with force:false to stay inside 2h/24h bands.
  const batch = buildGolfLineupReminders(league, members, {
    anyUnset: body.force !== false,
    windowsMs: REMINDER_WINDOWS_MS,
  });
  if (!batch?.reminders.length) {
    return NextResponse.json(
      { error: "no teams need a lineup reminder right now", batch: null },
      { status: 400 },
    );
  }

  const file = await readLineupReminders(leagueId, season);
  const pending = batch.reminders.filter(
    (r) => !wasReminderDelivered(file, r.deliveryKey),
  );
  if (!pending.length) {
    return NextResponse.json({
      batch,
      delivery: { ok: true, channel: "discord", skipped: true },
      delivered_keys: batch.reminders.map((r) => r.deliveryKey),
    });
  }

  const pendingBatch = { ...batch, reminders: pending };
  const delivery = await deliverDigestToDiscord(
    formatGolfReminderMessage(pendingBatch),
  );
  if (!delivery.ok) {
    return NextResponse.json(
      { error: delivery.error, batch: pendingBatch, delivery },
      { status: delivery.channel === "none" ? 503 : 502 },
    );
  }

  const keys = pending.map((r) => r.deliveryKey);
  await markRemindersDelivered(leagueId, season, keys);
  return NextResponse.json({
    batch: pendingBatch,
    delivery,
    delivered_keys: keys,
  });
}
