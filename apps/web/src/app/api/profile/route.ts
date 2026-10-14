/**
 * Self-service profile updates (username + bio for /u pages and feed).
 * Distinct from admin /api/admin/members — members may only edit themselves.
 */

import { NextResponse } from "next/server";

import {
  setMemberAvatarUrl,
  setMemberBio,
  setMemberDisplayName,
  validateBio,
  validateDisplayName,
  validateImageUrl,
} from "@/lib/hub-members";
import { updateHubMembers } from "@/lib/hub-members-store";
import { getViewer } from "@/lib/viewer";
import { requireSession, devBypassEnabled } from "@/lib/session";

export const dynamic = "force-dynamic";

type Body = {
  display_name?: string;
  bio?: string;
  /** HTTPS avatar override; "" clears back to the Google photo. */
  avatar_url?: string;
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

  if (
    body.display_name === undefined &&
    body.bio === undefined &&
    body.avatar_url === undefined
  ) {
    return NextResponse.json(
      { error: "display_name, bio, or avatar_url is required" },
      { status: 400 },
    );
  }

  try {
    // Validate before touching disk so bad input never enters the write queue.
    if (body.display_name !== undefined) validateDisplayName(body.display_name);
    if (body.bio !== undefined) validateBio(body.bio);
    if (body.avatar_url !== undefined) validateImageUrl(body.avatar_url);

    const email = viewer.email;
    const written = await updateHubMembers((file) => {
      let next = file;
      if (body.display_name !== undefined) {
        next = setMemberDisplayName(next, email, body.display_name);
      }
      if (body.bio !== undefined) {
        next = setMemberBio(next, email, body.bio);
      }
      if (body.avatar_url !== undefined) {
        next = setMemberAvatarUrl(next, email, body.avatar_url);
      }
      return next;
    });
    const member = written.members.find(
      (m) => m.email === email.toLowerCase(),
    );
    return NextResponse.json({
      display_name: member?.display_name ?? null,
      name: member?.display_name ?? viewer.name,
      bio: member?.bio ?? null,
      avatar_url: member?.avatar_url ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to save profile" },
      { status: 400 },
    );
  }
}
