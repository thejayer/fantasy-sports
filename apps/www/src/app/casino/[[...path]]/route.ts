import { auth } from "@/auth";
import { proxyCasino } from "@/lib/casino-proxy";

/**
 * /casino/** reverse proxy to the private sj-casino service. Replaces the
 * old next.config rewrite so every request (images included) is gated here
 * and carries a Google ID token upstream. CASINO_URL is read per request.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isSignedIn(): Promise<boolean> {
  if (process.env.AUTH_DEV_BYPASS === "1") return true;
  const session = await auth();
  return Boolean(session);
}

function handle(request: Request): Promise<Response> {
  return proxyCasino(request, { isSignedIn });
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
