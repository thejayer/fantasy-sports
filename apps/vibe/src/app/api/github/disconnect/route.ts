import { NextResponse } from "next/server";

import { getVibeActor } from "@/lib/session";
import { mutateVibeDocument } from "@/lib/vibe-store";

export const dynamic = "force-dynamic";

export async function POST() {
  const actor = await getVibeActor();
  if (!actor) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  await mutateVibeDocument(actor, (doc) => ({
    ...doc,
    github: {
      login: null,
      user_id: null,
      access_token_enc: null,
      token_kind: null,
      last_sync_at: null,
      last_sync_error: null,
    },
  }));
  return NextResponse.json({ ok: true });
}
