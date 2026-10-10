import { NextResponse } from "next/server";

import { encryptSecret } from "@/lib/crypto";
import { fetchGithubUser } from "@/lib/github";
import { exchangeGithubCode, readOauthState } from "@/lib/github-oauth";
import { getVibeSiteConfig } from "@/lib/site";
import { mutateVibeDocument } from "@/lib/vibe-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const site = getVibeSiteConfig().siteUrl;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const parsed = state ? readOauthState(state) : null;
  if (!code || !parsed) {
    return NextResponse.redirect(`${site}/settings?error=github-denied`);
  }
  try {
    const token = await exchangeGithubCode(code);
    const user = await fetchGithubUser(token);
    await mutateVibeDocument(
      { email: parsed.email, name: user.login, image: null, source: "session" },
      (doc) => ({
        ...doc,
        github: {
          ...doc.github,
          login: user.login,
          user_id: user.id,
          access_token_enc: encryptSecret(token),
          token_kind: "oauth",
          last_sync_error: null,
        },
      }),
    );
    return NextResponse.redirect(`${site}/settings?github=connected`);
  } catch {
    return NextResponse.redirect(`${site}/settings?error=github-exchange`);
  }
}
