import { auth } from "@/auth";
import type { CasinoMember } from "@/lib/casino-identity";
import { proxyCasino } from "@/lib/casino-proxy";

/**
 * /casino/** reverse proxy to the private sj-casino service. Replaces the
 * old next.config rewrite so every request (images included) is gated here
 * and carries a Google ID token upstream. CASINO_URL is read per request.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Signed-in member from the Auth.js session, or null. */
async function getMember(): Promise<CasinoMember | null> {
  if (process.env.AUTH_DEV_BYPASS === "1") {
    return { id: "dev-bypass", name: "Dev" };
  }
  const session = await auth();
  if (!session) return null;
  const user = (session.user ?? {}) as CasinoMember;
  return {
    googleSub: user.googleSub,
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
  };
}

function handle(request: Request): Promise<Response> {
  return proxyCasino(request, { getMember });
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
