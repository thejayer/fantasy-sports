import { casinoUpstream } from "@/lib/casino";
import { getCasinoMember } from "@/lib/casino-member";
import { syncWins } from "@/lib/casino-links";

/**
 * POST /casino/api/links/sync: the casino calls this when it loads. Reports
 * the signed-in member's linked teams' decided matchup results (from the
 * hub's synced data) to the casino's grant endpoint, which pays new wins.
 * Answers { paid, chips } (zeros for a member with no linked teams).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(): Promise<Response> {
  if (!casinoUpstream()) return new Response(null, { status: 404, headers: NO_STORE });
  if (!(await getCasinoMember())) {
    return new Response("Sign in to Strictly Jayers to use the casino.", {
      status: 401,
      headers: { ...NO_STORE, "content-type": "text/plain; charset=utf-8" },
    });
  }
  const out = await syncWins({ getMember: getCasinoMember });
  return Response.json(out, { headers: NO_STORE });
}
