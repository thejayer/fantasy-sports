/**
 * Fitness host config. Community and fantasy stay on their own Cloud Run
 * hosts — never route those products through this app.
 */
export type FitnessSiteConfig = {
  siteUrl: string;
  communitySiteUrl: string;
  fantasyHubUrl: string;
  discordInviteUrl: string | null;
};

/** Crew Discord invite — same default as the apex portal. */
export const DEFAULT_DISCORD_INVITE_URL = "https://discord.gg/6BH4CfB";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function optionalUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return trimTrailingSlash(value);
}

export function getFitnessSiteConfig(): FitnessSiteConfig {
  return {
    siteUrl: trimTrailingSlash(
      process.env.SITE_URL?.trim() || "http://localhost:3003",
    ),
    communitySiteUrl: trimTrailingSlash(
      process.env.COMMUNITY_SITE_URL?.trim() || "https://strictlyjayers.com",
    ),
    fantasyHubUrl: trimTrailingSlash(
      process.env.FANTASY_HUB_URL?.trim() ||
        "https://fantasy.strictlyjayers.com",
    ),
    discordInviteUrl:
      optionalUrl(process.env.DISCORD_INVITE_URL) || DEFAULT_DISCORD_INVITE_URL,
  };
}
