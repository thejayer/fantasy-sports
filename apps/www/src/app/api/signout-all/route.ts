import { signOut } from "@/auth";
import { isSameOriginRequest } from "@/lib/same-origin";
import { chainStep, type SiteKey } from "@/lib/signout-chain";
import { signoutSiteUrls } from "@/lib/signout-sites";
import { getSiteConfig } from "@/lib/site";

/**
 * Start "sign out of every Strictly Jayers site". POST only, same-origin only
 * (the confirm dialog posts a form here), so a link or an image on another
 * page can never sign anyone out. Signs this site out, then hands the browser
 * to the first sign-out hop (hub, fitness, vibe), which ends on /signed-out.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OTHER_SITES: SiteKey[] = ["hub", "fitness", "vibe"];

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request, getSiteConfig().siteUrl)) {
    return new Response("Forbidden", { status: 403, headers: { "cache-control": "no-store" } });
  }
  await signOut({ redirect: false });
  const secret = process.env.AUTH_SECRET ?? "";
  // Without the shared secret there is no way to sign a hop, so only this site is cleared.
  return chainStep(signoutSiteUrls(), secret, secret ? OTHER_SITES : []);
}

export function GET(): Response {
  return new Response("Use the Sign out button.", {
    status: 405,
    headers: { allow: "POST", "cache-control": "no-store" },
  });
}
