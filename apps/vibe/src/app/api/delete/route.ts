import { NextResponse } from "next/server";

import { getVibeActor } from "@/lib/session";
import { deleteVibeDocument } from "@/lib/vibe-store";

export const dynamic = "force-dynamic";

export async function POST() {
  const actor = await getVibeActor();
  if (!actor) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  await deleteVibeDocument(actor.email);
  return NextResponse.json({ ok: true });
}
