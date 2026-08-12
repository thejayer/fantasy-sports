/**
 * Self-service profile updates (username + bio for /u pages and feed).
 * Distinct from admin /api/admin/members — members may only edit themselves.
 */

import { NextResponse } from "next/server";

import {
  setMemberBio,
  setMemberDisplayName,
  validateBio,
  validateDisplayName,
} from "@/lib/hub-members";
import {
  readHubMembers,
  writeHubMembers,
} from "@/lib/hub-members-store";
import { getViewer } from "@/lib/viewer";
import { requireSession, devBypassEnabled } from "@/lib/session";

export const dynamic = "force-dynamic";

type Body = {
  display_name?: string;
  bio?: string;
};

export async function PATCH(request: Request) {
  await requireSession();
  const viewer = await getViewer();
  if (!viewer.email) {
    if (devBypassEnabled()) {
      return NextResponse.json(
        { error: "set SJ_DEV_VIEWER_EMAIL to edit a profile under bypass" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "sign in required" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (body.display_name === undefined && body.bio === undefined) {
    return NextResponse.json(
      { error: "display_name or bio is required" },
      { status: 400 },
    );
  }

  try {
    let file = await readHubMembers();
    if (body.display_name !== undefined) {
      validateDisplayName(body.display_name);
      file = setMemberDisplayName(file, viewer.email, body.display_name);
    }
    if (body.bio !== undefined) {
      validateBio(body.bio);
      file = setMemberBio(file, viewer.email, body.bio);
    }
    const written = await writeHubMembers(file);
    const member = written.members.find(
      (m) => m.email === viewer.email?.toLowerCase(),
    );
    return NextResponse.json({
      display_name: member?.display_name ?? null,
      name: member?.display_name ?? viewer.name,
      bio: member?.bio ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to save profile" },
      { status: 400 },
    );
  }
}
