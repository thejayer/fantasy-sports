import { NextResponse } from "next/server";

import { parseHealthAutoExport } from "@/lib/health-auto-export";
import { actorForIngestRequest } from "@/lib/ingest-auth";
import { extractIngestToken } from "@/lib/ingest-token";
import { upsertWorkouts } from "@/lib/vibe-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!extractIngestToken(request)) {
    return NextResponse.json({ error: "ingest token required" }, { status: 401 });
  }
  const actor = await actorForIngestRequest(request);
  if (!actor) {
    return NextResponse.json({ error: "invalid ingest token" }, { status: 401 });
  }

  let payload: unknown;
  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("text/plain")) {
      const text = await request.text();
      payload = JSON.parse(text);
    } else {
      payload = await request.json();
    }
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const workouts = parseHealthAutoExport(payload);
  if (!workouts.length) {
    return NextResponse.json({
      ok: true,
      added: 0,
      parsed: 0,
      note: "no workouts recognized",
    });
  }
  const { added } = await upsertWorkouts(actor, workouts);
  return NextResponse.json({
    ok: true,
    added,
    parsed: workouts.length,
  });
}
