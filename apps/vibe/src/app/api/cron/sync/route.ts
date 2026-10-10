import { NextResponse } from "next/server";

import { githubIsStale } from "@/lib/github";
import { listVibeUserEmails, readVibeDocument } from "@/lib/vibe-store";
import { syncGithubForActor } from "@/lib/sync-github";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^bearer\s+/i, "").trim();
  return token === secret;
}

/**
 * Optional Cloud Scheduler target. Same sj-vibe service — no extra job image.
 * Primary refresh is on-visit + Settings → Sync now (30 min staleness).
 */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const emails = await listVibeUserEmails();
  let synced = 0;
  let skipped = 0;
  for (const email of emails) {
    const doc = await readVibeDocument(email);
    if (!doc?.github.access_token_enc) {
      skipped += 1;
      continue;
    }
    if (!githubIsStale(doc.github.last_sync_at)) {
      skipped += 1;
      continue;
    }
    await syncGithubForActor(
      { email, name: doc.display_name, image: doc.image_url, source: "session" },
      { force: true },
    );
    synced += 1;
  }
  return NextResponse.json({ ok: true, synced, skipped, users: emails.length });
}
