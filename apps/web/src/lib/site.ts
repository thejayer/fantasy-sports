/**
 * Hub host config. Community / fitness stay on their own Cloud Run hosts —
 * never route those products through this app.
 */
export type HubSiteConfig = {
  siteUrl: string;
  communitySiteUrl: string;
  fitnessUrl: string;
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

export function getHubSiteConfig(): HubSiteConfig {
  return {
    siteUrl: trimTrailingSlash(
      process.env.AUTH_URL?.trim() ||
        process.env.SITE_URL?.trim() ||
        "http://localhost:3000",
    ),
    communitySiteUrl: trimTrailingSlash(
      process.env.COMMUNITY_SITE_URL?.trim() || "https://strictlyjayers.com",
    ),
    fitnessUrl: trimTrailingSlash(
      process.env.FITNESS_URL?.trim() || "https://fitness.strictlyjayers.com",
    ),
    discordInviteUrl:
      optionalUrl(process.env.DISCORD_INVITE_URL) || DEFAULT_DISCORD_INVITE_URL,
  };
}
