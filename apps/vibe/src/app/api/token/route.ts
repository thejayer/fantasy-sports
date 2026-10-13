import { NextResponse } from "next/server";

import {
  generateIngestToken,
  hashIngestToken,
  tokenPrefix,
} from "@/lib/ingest-token";
import { getVibeActor } from "@/lib/session";
import { mutateVibeDocument } from "@/lib/vibe-store";

export const dynamic = "force-dynamic";

export async function POST() {
  const actor = await getVibeActor();
  if (!actor) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const token = generateIngestToken();
  const document = await mutateVibeDocument(actor, (doc) => ({
    ...doc,
    ingest: {
      token_hash: hashIngestToken(token),
      token_prefix: tokenPrefix(token),
      created_at: new Date().toISOString(),
    },
  }));
  return NextResponse.json({
    ok: true,
    token,
    prefix: document.ingest.token_prefix,
    created_at: document.ingest.created_at,
  });
}
