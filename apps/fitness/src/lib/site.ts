/**
 * Fitness host config. Community and fantasy stay on their own Cloud Run
 * hosts — never route those products through this app.
 */
export type FitnessSiteConfig = {
  siteUrl: string;
  communitySiteUrl: string;
  fantasyHubUrl: string;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
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
  };
}
