import { NextResponse } from "next/server";

import {
  FitnessConflictError,
  ensureAthleteDocument,
  saveAthleteSlices,
} from "@/lib/fitness-store";
import { getFitnessActor } from "@/lib/session";
import { storagePrefixForEmail } from "@/lib/user-key";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "sign in required" }, { status: 401 });
}

function publicUser(actor: {
  email: string;
  name: string;
  image: string | null;
}) {
  return {
    email: actor.email,
    name: actor.name,
    image: actor.image,
  };
}

/** Current member's profile + training log. Path is derived from the session. */
export async function GET() {
  const actor = await getFitnessActor();
  if (!actor) return unauthorized();
  const document = await ensureAthleteDocument(actor);
  return NextResponse.json({
    user: publicUser(actor),
    storagePrefix: storagePrefixForEmail(actor.email),
    document,
  });
}

/**
 * Replace this member's slices. `email` / `userId` in the body are ignored —
 * isolation is the session, not the payload.
 */
export async function PUT(request: Request) {
  const actor = await getFitnessActor();
  if (!actor) return unauthorized();

  let body: { slices?: unknown; migrate?: unknown } = {};
  try {
    body = (await request.json()) as { slices?: unknown; migrate?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const document = await saveAthleteSlices(actor, body.slices, {
      migrate: body.migrate === true,
    });
    return NextResponse.json({
      user: publicUser(actor),
      storagePrefix: storagePrefixForEmail(actor.email),
      document,
    });
  } catch (err) {
    if (err instanceof FitnessConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
