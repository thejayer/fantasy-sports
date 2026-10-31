import { signOut } from "@/auth";
import { runHop } from "@/lib/signout-chain";
import { signoutSiteUrls } from "@/lib/signout-sites";

/**
 * One hop of the sign-out-everywhere chain: clears this site's session, then
 * sends the browser on to the next Strictly Jayers site. Needs a signed,
 * short-lived token (see lib/signout-chain.ts); anything else signs nobody out.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("t");
  return runHop(token, {
    secret: process.env.AUTH_SECRET,
    urls: signoutSiteUrls(),
    signOutLocal: () => signOut({ redirect: false }),
  });
}
