/**
 * Deep links out to ESPN (roadmap 7.3).
 *
 * The hub has no write path to ESPN and should not pretend otherwise, so rather
 * than dead-ending a member who wants to act, send them to the ESPN page that
 * can. `espn_league_id` is on every synced snapshot; hub-native sports (golf)
 * have none and get no links.
 */

const SPORT_PATH: Record<string, string> = {
  football: "football",
  baseball: "baseball",
};

export type EspnLinkContext = {
  sport: string;
  espnLeagueId: number | null | undefined;
  season: number;
};

function base(ctx: EspnLinkContext): string | null {
  const sport = SPORT_PATH[ctx.sport];
  if (!sport || ctx.espnLeagueId == null) return null;
  return `https://fantasy.espn.com/${sport}/`;
}

function withQuery(
  url: string,
  params: Record<string, string | number | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null) query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `${url}?${qs}` : url;
}

export function espnLeagueUrl(ctx: EspnLinkContext): string | null {
  const root = base(ctx);
  if (!root) return null;
  return withQuery(`${root}league`, {
    leagueId: ctx.espnLeagueId!,
    seasonId: ctx.season,
  });
}

export function espnTeamUrl(
  ctx: EspnLinkContext,
  teamId: number,
): string | null {
  const root = base(ctx);
  if (!root) return null;
  return withQuery(`${root}team`, {
    leagueId: ctx.espnLeagueId!,
    seasonId: ctx.season,
    teamId,
  });
}

export function espnPlayersUrl(ctx: EspnLinkContext): string | null {
  const root = base(ctx);
  if (!root) return null;
  return withQuery(`${root}players/add`, {
    leagueId: ctx.espnLeagueId!,
    seasonId: ctx.season,
  });
}

/**
 * ESPN's own player card lives on the main site rather than the fantasy app and
 * does not need a league id, so it is available for any synced sport.
 */
export function espnPlayerUrl(
  sport: string,
  playerId: string | number | null | undefined,
): string | null {
  if (playerId == null) return null;
  const id = String(playerId).trim();
  if (!id || !/^\d+$/.test(id)) return null;
  const path = sport === "baseball" ? "mlb" : sport === "football" ? "nfl" : null;
  if (!path) return null;
  return `https://www.espn.com/${path}/player/_/id/${id}`;
}

export function espnTransactionsUrl(ctx: EspnLinkContext): string | null {
  const root = base(ctx);
  if (!root) return null;
  return withQuery(`${root}league/transactions`, {
    leagueId: ctx.espnLeagueId!,
    seasonId: ctx.season,
  });
}

export function espnSettingsUrl(ctx: EspnLinkContext): string | null {
  const root = base(ctx);
  if (!root) return null;
  return withQuery(`${root}league/settings`, {
    leagueId: ctx.espnLeagueId!,
    seasonId: ctx.season,
  });
}
