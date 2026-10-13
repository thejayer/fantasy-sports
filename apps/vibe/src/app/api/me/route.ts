import { NextResponse } from "next/server";

import { loadVibe, publicGithub } from "@/lib/load";
import { homeStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET() {
  const loaded = await loadVibe();
  if (!loaded) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const { actor, document, rows } = loaded;
  return NextResponse.json({
    user: { email: actor.email, name: actor.name, image: actor.image },
    settings: document.settings,
    ingest: {
      configured: Boolean(document.ingest.token_hash),
      token_prefix: document.ingest.token_prefix,
      created_at: document.ingest.created_at,
    },
    github: publicGithub(document),
    home: homeStats(rows, document.settings.timezone),
    workouts: rows.length,
  });
}
