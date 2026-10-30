import { casinoUpstream } from "@/lib/casino";
import { getCasinoMember } from "@/lib/casino-member";
import { claimTeam, getLinksView } from "@/lib/casino-links";
import { proxyCasino } from "@/lib/casino-proxy";

/**
 * /casino/api/links: the casino's "Link my teams" API, with the portal's
 * hub data merged in. Lives under /casino/** so the sign-in gate (middleware)
 * and the session check in proxyCasino both apply, and it takes precedence
 * over the /casino catch-all proxy for this one path.
 *
 *  GET     the member's links, taken teams, and the leagues and teams to pick from
 *  POST    { league, team }: checked against the hub, then stored by the casino
 *  DELETE  { league } (own link) or { league, team } (mod): passed through
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;
const deps = { getMember: getCasinoMember };

function off(): Response | null {
  return casinoUpstream() ? null : new Response(null, { status: 404, headers: NO_STORE });
}

export async function GET(): Promise<Response> {
  return off() ?? getLinksView(deps);
}

export async function POST(request: Request): Promise<Response> {
  const disabled = off();
  if (disabled) return disabled;
  const body = await request.json().catch(() => null);
  return claimTeam(deps, body);
}

export function DELETE(request: Request): Promise<Response> | Response {
  return off() ?? proxyCasino(request, { getMember: getCasinoMember });
}
