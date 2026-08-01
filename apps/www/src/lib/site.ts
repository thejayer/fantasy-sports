/**
 * Apex portal config. Fantasy is a separate Cloud Run host — never route
 * through this app with a relative `/leagues` path.
 */
export type SiteConfig = {
  siteUrl: string;
  fantasyHubUrl: string;
  discordInviteUrl: string | null;
  palworldInfoUrl: string | null;
};

/** Crew Discord invite — override with DISCORD_INVITE_URL on sj-www if rotated. */
export const DEFAULT_DISCORD_INVITE_URL = "https://discord.gg/6BH4CfB";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function optionalUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return trimTrailingSlash(value);
}

export function getSiteConfig(): SiteConfig {
  return {
    siteUrl: trimTrailingSlash(
      process.env.SITE_URL?.trim() || "http://localhost:3002",
    ),
    fantasyHubUrl: trimTrailingSlash(
      process.env.FANTASY_HUB_URL?.trim() ||
        "https://fantasy.strictlyjayers.com",
    ),
    discordInviteUrl:
      optionalUrl(process.env.DISCORD_INVITE_URL) || DEFAULT_DISCORD_INVITE_URL,
    palworldInfoUrl: optionalUrl(process.env.PALWORLD_INFO_URL),
  };
}
