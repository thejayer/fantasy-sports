import { NextResponse } from "next/server";

import { githubAuthorizeUrl, createOauthState } from "@/lib/github-oauth";
import { getVibeActor } from "@/lib/session";
import { getVibeSiteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function GET() {
  const site = getVibeSiteConfig().siteUrl;
  const actor = await getVibeActor();
  if (!actor) {
    return NextResponse.redirect(`${site}/login`);
  }
  if (!process.env.GITHUB_CLIENT_ID) {
    return NextResponse.redirect(`${site}/settings?error=github-oauth-unconfigured`);
  }
  const url = githubAuthorizeUrl(createOauthState(actor.email));
  return NextResponse.redirect(url);
}
