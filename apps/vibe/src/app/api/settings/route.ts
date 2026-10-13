import { NextResponse } from "next/server";

import { getVibeActor } from "@/lib/session";
import { clampBufferMinutes } from "@/lib/vibe-document";
import { mutateVibeDocument } from "@/lib/vibe-store";
import { isValidTimeZone, resolveTimeZone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await getVibeActor();
  if (!actor) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  let body: { buffer_minutes?: unknown; timezone?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const timezone =
    typeof body.timezone === "string" && isValidTimeZone(body.timezone)
      ? body.timezone
      : resolveTimeZone(
          typeof body.timezone === "string" ? body.timezone : undefined,
        );
  const document = await mutateVibeDocument(actor, (doc) => ({
    ...doc,
    settings: {
      buffer_minutes:
        body.buffer_minutes == null
          ? doc.settings.buffer_minutes
          : clampBufferMinutes(body.buffer_minutes),
      timezone: body.timezone == null ? doc.settings.timezone : timezone,
    },
  }));
  return NextResponse.json({ ok: true, settings: document.settings });
}
