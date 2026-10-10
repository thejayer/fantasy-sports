import { NextResponse } from "next/server";

import {
  createAppleHealthWorkoutScanner,
  extractExportXmlFromZip,
  parseAppleHealthWorkouts,
} from "@/lib/apple-health";
import { getVibeActor } from "@/lib/session";
import { upsertWorkouts } from "@/lib/vibe-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  let xml: string;
  if (name.endsWith(".zip") || buf.subarray(0, 2).toString() === "PK") {
    const extracted = extractExportXmlFromZip(buf);
    if (!extracted) {
      return NextResponse.json(
        { error: "export.xml not found in zip" },
        { status: 400 },
      );
    }
    xml = extracted;
  } else {
    xml = buf.toString("utf8");
  }

  const scanner = createAppleHealthWorkoutScanner();
  const chunk = 1_000_000;
  for (let i = 0; i < xml.length; i += chunk) {
    scanner.push(xml.slice(i, i + chunk));
  }
  const workouts = scanner.finish();
  const fallback = workouts.length ? workouts : parseAppleHealthWorkouts(xml);
  const { added } = await upsertWorkouts(actor, fallback);
  return NextResponse.json({
    ok: true,
    added,
    parsed: fallback.length,
  });
}
