import { casinoUpstream } from "@/lib/casino";
import { getCasinoMember } from "@/lib/casino-member";
import { getCasinoSummary } from "@/lib/casino-summary";

/**
 * GET /casino/portal-summary: today's casino top 3 and hot machines for the
 * home-page box. Lives under /casino/** so the sign-in gate (middleware) and
 * the session check below both apply; signed-out callers get a bare 401 and
 * the home page simply shows nothing. The casino itself is reached through
 * the authenticated proxy path (lib/casino-summary.ts), cached ~30 s.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(): Promise<Response> {
  if (!casinoUpstream()) return new Response(null, { status: 404, headers: NO_STORE });
  if (!(await getCasinoMember())) {
    return new Response("Sign in to Strictly Jayers to use the casino.", {
      status: 401,
      headers: { ...NO_STORE, "content-type": "text/plain; charset=utf-8" },
    });
  }
  const summary = await getCasinoSummary({ getMember: getCasinoMember });
  if (!summary) return new Response(null, { status: 503, headers: NO_STORE });
  return Response.json(summary, {
    headers: { "cache-control": "private, max-age=30" },
  });
}
