import { signOut } from "@/auth";
import { startChain } from "@/lib/signout-chain";
import { signoutSiteUrls } from "@/lib/signout-sites";

/**
 * Start "sign out of every Strictly Jayers site" from here. POST only,
 * same-origin only (the shared confirm posts a form here), so a link or an
 * image on another page can never sign anyone out. Signs this site out first,
 * then hands the browser to the next sign-out hop (www first), which ends on
 * the www /signed-out page. See lib/signout-chain.ts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return startChain(request, {
    self: "vibe",
    secret: process.env.AUTH_SECRET,
    urls: signoutSiteUrls(),
    signOutLocal: () => signOut({ redirect: false }),
    localLanding: "/login",
  });
}

export function GET(): Response {
  return new Response("Use the Sign out button.", {
    status: 405,
    headers: { allow: "POST", "cache-control": "no-store" },
  });
}
