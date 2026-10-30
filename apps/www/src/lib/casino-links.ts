/**
 * Team linking for the casino ("Link my teams"), portal side.
 *
 * The casino stores who linked which team and pays chips for matchup wins; it
 * never sees ESPN data. The portal is the only part that reads the hub's
 * synced leagues, so it (1) lists the teams a member can pick, (2) checks a
 * pick against the hub before asking the casino to store it, and (3) reports
 * a member's linked teams' decided matchup results to the casino's private
 * grant endpoint. Its calls carry the portal's service header, which the
 * proxy only ever sets from server code (every browser `x-sj-*` is stripped).
 * See PORTAL.md.
 */

import type { CasinoMember } from "@/lib/casino-identity";
import { CASINO_BASE_PATH, proxyCasino, type CasinoProxyDeps } from "@/lib/casino-proxy";
import {
  listEspnLeagues,
  readSeason,
  type HubLeague,
  type HubSeason,
} from "@/lib/hub-snapshots";

export const SERVICE_HEADER = "x-sj-service";
export const SERVICE_VALUE = "casino-grants";
export const LINKS_PATH = `${CASINO_BASE_PATH}/api/links`;
export const GRANTS_PATH = `${CASINO_BASE_PATH}/api/grants`;
const CALL_TIMEOUT_MS = 8_000;
/** A season's file is re-read at most this often (many members load the casino at once). */
export const SEASON_TTL_MS = 60_000;

type Proxy = Partial<Parameters<typeof proxyCasino>[1]>;

export type LinksDeps = {
  getMember: () => Promise<CasinoMember | null>;
  /** Passed through to proxyCasino (tests). */
  proxy?: Proxy;
  /** Reads the hub (tests). */
  hub?: {
    leagues: () => Promise<HubLeague[] | null>;
    season: (l: HubLeague) => Promise<HubSeason | null>;
  };
};

export function liveHub() {
  return { leagues: listEspnLeagues, season: readSeason };
}

type CacheEntry = { at: number; season: HubSeason | null };
const seasonCache = new Map<string, CacheEntry>();

export function resetSeasonCache(): void {
  seasonCache.clear();
}

async function season(
  deps: LinksDeps,
  league: HubLeague,
  now: number,
): Promise<HubSeason | null> {
  const hub = deps.hub ?? liveHub();
  // Only the live hub is cached; tests inject their own reader.
  if (deps.hub) return hub.season(league);
  const key = `${league.leagueId}/${league.season}`;
  const hit = seasonCache.get(key);
  if (hit && now - hit.at < SEASON_TTL_MS) return hit.season;
  const fresh = await hub.season(league);
  seasonCache.set(key, { at: now, season: fresh });
  return fresh;
}

function casinoCall(
  deps: LinksDeps,
  method: string,
  path: string,
  body: unknown,
  service: boolean,
): Promise<Response> {
  const request = new Request(`http://portal.internal${path}`, {
    method,
    headers: { accept: "application/json", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const proxyDeps: CasinoProxyDeps = {
    getMember: deps.getMember,
    timeoutMs: CALL_TIMEOUT_MS,
    ...deps.proxy,
    ...(service ? { serviceHeaders: { [SERVICE_HEADER]: SERVICE_VALUE } } : {}),
  };
  return proxyCasino(request, proxyDeps);
}

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** GET: the casino's view (my links, taken keys, mod flag) plus the leagues and teams to pick from. */
export async function getLinksView(
  deps: LinksDeps,
  now = Date.now(),
): Promise<Response> {
  const res = await casinoCall(deps, "GET", LINKS_PATH, undefined, false);
  if (!res.ok) return res;
  const view = rec(await res.json().catch(() => null));
  if (!view) return new Response("Casino is unavailable.", { status: 502 });
  const hub = deps.hub ?? liveHub();
  const leagues = await hub.leagues().catch(() => null);
  let picker: unknown[] | undefined;
  if (leagues) {
    const seasons = await Promise.all(leagues.map((l) => season(deps, l, now)));
    picker = seasons.flatMap((s) =>
      s
        ? [
            {
              league: s.league.leagueId,
              name: s.league.name,
              teams: s.teams,
            },
          ]
        : [],
    );
  }
  return Response.json(
    picker ? { ...view, leagues: picker } : view,
    { headers: { "cache-control": "no-store" } },
  );
}

/** POST: check the pick against the hub, then have the casino store it. */
export async function claimTeam(
  deps: LinksDeps,
  body: unknown,
  now = Date.now(),
): Promise<Response> {
  const b = rec(body);
  const leagueId = b && typeof b.league === "string" ? b.league : "";
  const teamId = b && typeof b.team === "string" ? b.team : "";
  const bad = () =>
    Response.json(
      { error: "That team isn't in the league list." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  if (!leagueId || !teamId) return bad();
  const hub = deps.hub ?? liveHub();
  const leagues = await hub.leagues().catch(() => null);
  const league = leagues?.find((l) => l.leagueId === leagueId);
  if (!league) return bad();
  const s = await season(deps, league, now);
  const team = s?.teams.find((t) => t.team === teamId);
  if (!s || !team) return bad();
  const res = await casinoCall(
    deps,
    "POST",
    LINKS_PATH,
    {
      league: league.leagueId,
      team: team.team,
      label: team.label,
      leagueName: league.name,
      owner: team.owner,
    },
    true,
  );
  if (res.ok) {
    // Record the baseline now, so only wins from here on are paid.
    await syncWins(deps, now).catch(() => null);
  }
  return res;
}

export type SyncSummary = { paid: number; chips: number };

/**
 * Report the signed-in member's linked teams' results to the casino, which
 * pays new wins. Only their own links are reported; a member with none costs
 * one casino call. The casino decides who is paid and how much.
 */
export async function syncWins(
  deps: LinksDeps,
  now = Date.now(),
): Promise<SyncSummary> {
  const none: SyncSummary = { paid: 0, chips: 0 };
  const res = await casinoCall(deps, "GET", LINKS_PATH, undefined, false);
  if (!res.ok) return none;
  const view = rec(await res.json().catch(() => null));
  const links = Array.isArray(view?.links) ? (view.links as unknown[]) : [];
  const mine = new Map<string, Set<string>>();
  for (const raw of links) {
    const l = rec(raw);
    if (!l || typeof l.league !== "string" || typeof l.team !== "string") continue;
    (mine.get(l.league) ?? mine.set(l.league, new Set()).get(l.league))!.add(l.team);
  }
  if (mine.size === 0) return none;
  const hub = deps.hub ?? liveHub();
  const leagues = (await hub.leagues().catch(() => null)) ?? [];
  const results: unknown[] = [];
  for (const league of leagues) {
    const teams = mine.get(league.leagueId);
    if (!teams) continue;
    const s = await season(deps, league, now);
    if (!s) continue;
    for (const r of s.results) {
      if (!teams.has(r.team)) continue;
      results.push({
        league: league.leagueId,
        team: r.team,
        season: league.season,
        period: r.period,
        outcome: r.outcome,
      });
    }
  }
  if (results.length === 0) return none;
  const out = await casinoCall(deps, "POST", GRANTS_PATH, { results }, true);
  if (!out.ok) return none;
  const summary = rec(await out.json().catch(() => null));
  const paid = typeof summary?.paid === "number" ? summary.paid : 0;
  const chips = typeof summary?.chips === "number" ? summary.chips : 0;
  return { paid, chips };
}
