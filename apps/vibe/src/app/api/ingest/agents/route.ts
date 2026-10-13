import { NextResponse } from "next/server";

import { parseAgentRunsPayload } from "@/lib/agents";
import { actorForIngestRequest } from "@/lib/ingest-auth";
import { extractIngestToken } from "@/lib/ingest-token";
import { upsertAgentRuns } from "@/lib/vibe-store";

export const dynamic = "force-dynamic";

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
    if (contentType.includes("text/") || contentType.includes("csv")) {
      payload = await request.text();
    } else {
      payload = await request.json();
    }
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const runs = parseAgentRunsPayload(payload);
  const { added } = await upsertAgentRuns(actor, runs);
  return NextResponse.json({
    ok: true,
    added,
    parsed: runs.length,
    beta: true,
  });
}
