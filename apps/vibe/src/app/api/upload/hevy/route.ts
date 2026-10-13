import { NextResponse } from "next/server";

import { parseHevyWorkoutCsv } from "@/lib/hevy-csv";
import { getVibeActor } from "@/lib/session";
import { upsertWorkouts } from "@/lib/vibe-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await getVibeActor();
  if (!actor) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const text = await file.text();
  const workouts = parseHevyWorkoutCsv(text);
  const { added } = await upsertWorkouts(actor, workouts);
  return NextResponse.json({ ok: true, added, parsed: workouts.length });
}
