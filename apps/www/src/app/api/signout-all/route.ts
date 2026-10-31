import { signOut } from "@/auth";
import { startChain } from "@/lib/signout-chain";
import { signoutSiteUrls } from "@/lib/signout-sites";

/**
 * Start "sign out of every Strictly Jayers site" from www. POST only,
 * same-origin only (the confirm dialog posts a form here), so a link or an
 * image on another page can never sign anyone out. Signs this site out, then
 * hands the browser to the first sign-out hop (hub, fitness, vibe), which ends
 * on /signed-out. Hub, fitness and vibe start the same chain from their own
 * POST /api/auth/signout-all. See lib/signout-chain.ts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return startChain(request, {
    self: "www",
    secret: process.env.AUTH_SECRET,
    urls: signoutSiteUrls(),
    signOutLocal: () => signOut({ redirect: false }),
    localLanding: "/signed-out",
  });
}

export function GET(): Response {
  return new Response("Use the Sign out button.", {
    status: 405,
    headers: { allow: "POST", "cache-control": "no-store" },
  });
}
