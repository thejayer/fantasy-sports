import { NextResponse } from "next/server";

import { getVibeActor } from "@/lib/session";
import { publicGithub } from "@/lib/load";
import { syncGithubForActor } from "@/lib/sync-github";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const actor = await getVibeActor();
  if (!actor) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  let force = false;
  try {
    const body = (await request.json()) as { force?: boolean };
    force = body.force === true;
  } catch {
    force = false;
  }
  const document = await syncGithubForActor(actor, { force });
  return NextResponse.json({
    ok: !document.github.last_sync_error,
    github: publicGithub(document),
    events: document.events.length,
  });
}
