/**
 * Who is looking at this page, and which franchise is theirs (roadmap 7.1).
 *
 * `hub_members.json` has linked email → franchise since phase 5, but only the
 * golf ACL read it, so every football/baseball screen rendered twelve identical
 * rows. This resolves the same link for *all* sports so standings, matchups,
 * team pages, and the decision tools can lead with the viewer's team.
 *
 * Deliberately fail-soft: an unlinked member, a signed-out request, or a
 * missing members file all resolve to `null`, and every consumer must render
 * the non-personalised layout unchanged in that case.
 */

import { cache } from "react";

import {
  canAccessAdmin,
  findMember,
  memberFranchises,
  parseAllowedEmailsEnv,
  resolveMemberDisplayName,
  type HubMemberTeamLink,
} from "@/lib/hub-members";
import { readHubMembers } from "@/lib/hub-members-store";
import { auth } from "@/auth";
import { devBypassEnabled } from "@/lib/session";

export type Viewer = {
  email: string | null;
  /** Public display name — custom username, else Google name / email. */
  name: string | null;
  /** Custom hub username when set (empty string means unset). */
  displayName: string | null;
  /** HTTPS avatar (hub_members or Google session); null → monogram. */
  imageUrl: string | null;
  isAdmin: boolean;
  /** One linked franchise per league. Empty when unlinked. */
  franchises: HubMemberTeamLink[];
  /**
   * `dev` when the franchise came from SJ_DEV_VIEWER_EMAIL under
   * AUTH_DEV_BYPASS rather than a real session.
   */
  source: "session" | "dev" | "anonymous";
};

const ANONYMOUS: Viewer = {
  email: null,
  name: null,
  displayName: null,
  imageUrl: null,
  isAdmin: false,
  franchises: [],
  source: "anonymous",
};

function httpsImage(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  return trimmed && /^https:\/\//i.test(trimmed) ? trimmed : null;
}

/**
 * `AUTH_DEV_BYPASS=1` has no session, so there is no email to link a franchise
 * to. Local dev and the e2e smoke need a way to exercise the personalised
 * layout, so bypass honours an explicit impersonation address. Without it,
 * bypass stays anonymous and the UI keeps its non-personalised shape.
 */
function devViewerEmail(): string | null {
  const raw = process.env.SJ_DEV_VIEWER_EMAIL?.trim().toLowerCase();
  return raw || null;
}

export const getViewer = cache(async (): Promise<Viewer> => {
  const adminOpts = {
    envAllowlist: parseAllowedEmailsEnv(process.env.ALLOWED_EMAILS),
    adminEmailsEnv: parseAllowedEmailsEnv(process.env.ADMIN_EMAILS),
  };

  if (devBypassEnabled()) {
    const email = devViewerEmail();
    if (!email) return ANONYMOUS;
    const file = await readHubMembers().catch(() => null);
    const member = file ? findMember(file, email) : undefined;
    const custom = member?.display_name?.trim() || null;
    return {
      email,
      name: resolveMemberDisplayName(member, email),
      displayName: custom,
      imageUrl: httpsImage(member?.image_url),
      isAdmin: true,
      franchises: memberFranchises(file, email),
      source: "dev",
    };
  }

  const session = await auth();
  const email = session?.user?.email ?? null;
  if (!email) return ANONYMOUS;

  const file = await readHubMembers().catch(() => null);
  const member = file ? findMember(file, email) : undefined;
  const custom = member?.display_name?.trim() || null;
  const fallback = session?.user?.name ?? email;
  return {
    email,
    name: resolveMemberDisplayName(member, fallback),
    displayName: custom,
    imageUrl: httpsImage(member?.image_url) ?? httpsImage(session?.user?.image),
    isAdmin: canAccessAdmin(email, file, adminOpts),
    franchises: memberFranchises(file, email),
    source: "session",
  };
});

/** The viewer's franchise in one league, or null when unlinked. */
export async function getViewerFranchise(
  leagueId: string,
): Promise<HubMemberTeamLink | null> {
  const viewer = await getViewer();
  return viewer.franchises.find((f) => f.league_id === leagueId) ?? null;
}

/**
 * Convenience for components that only need the id. `undefined` (not `null`)
 * so it drops out of JSX props cleanly when there is nothing to highlight.
 */
export async function getViewerTeamId(
  leagueId: string,
): Promise<number | undefined> {
  const link = await getViewerFranchise(leagueId);
  return link ? link.team_id : undefined;
}
