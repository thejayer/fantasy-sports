/**
 * Server helpers for email↔franchise ACL on golf mutations.
 * Pure rules live in hub-members.ts; this loads session + hub_members.json.
 */

import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import {
  assertCanActAsTeam,
  assertCanControlAuction,
  assertCanFinalizeAuction,
  golfActingScope,
  parseAllowedEmailsEnv,
  type FranchiseAclContext,
  type GolfActingScope,
} from "@/lib/hub-members";
import { readHubMembers } from "@/lib/hub-members-store";
import { auth } from "@/auth";
import { devBypassEnabled, requireSession } from "@/lib/session";

function envAclOpts(): Pick<
  FranchiseAclContext,
  "envAllowlist" | "adminEmailsEnv" | "devBypass"
> {
  return {
    envAllowlist: parseAllowedEmailsEnv(process.env.ALLOWED_EMAILS),
    adminEmailsEnv: parseAllowedEmailsEnv(process.env.ADMIN_EMAILS),
    devBypass: devBypassEnabled(),
  };
}

async function aclContext(
  leagueId: string,
  session: Session | null,
): Promise<FranchiseAclContext> {
  const file = await readHubMembers();
  return {
    email: session?.user?.email,
    file,
    leagueId,
    ...envAclOpts(),
  };
}

function deny(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 403 });
}

/** null = allowed; otherwise a 403 JSON response. */
export async function enforceTeamAction(
  leagueId: string,
  teamId: number,
): Promise<NextResponse | null> {
  const session = await requireSession();
  const ctx = await aclContext(leagueId, session);
  const result = assertCanActAsTeam({ ...ctx, teamId });
  return result.ok ? null : deny(result.error);
}

export async function enforceAuctionControl(
  leagueId: string,
): Promise<NextResponse | null> {
  const session = await requireSession();
  const ctx = await aclContext(leagueId, session);
  const result = assertCanControlAuction(ctx);
  return result.ok ? null : deny(result.error);
}

export async function enforceAuctionFinalize(
  leagueId: string,
): Promise<NextResponse | null> {
  const session = await requireSession();
  const ctx = await aclContext(leagueId, session);
  const result = assertCanFinalizeAuction(ctx);
  return result.ok ? null : deny(result.error);
}

/** Server components: acting-team UI for golf league pages. */
export async function resolveGolfActingScope(
  leagueId: string,
  leagueTeamIds: number[],
): Promise<GolfActingScope> {
  if (devBypassEnabled()) {
    return golfActingScope(
      {
        email: null,
        file: null,
        leagueId,
        ...envAclOpts(),
      },
      leagueTeamIds,
    );
  }
  const session = await auth();
  const ctx = await aclContext(leagueId, session);
  return golfActingScope(ctx, leagueTeamIds);
}

export type { GolfActingScope };
