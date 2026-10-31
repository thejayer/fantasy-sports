import { getFitnessSiteConfig } from "@/lib/site";
import type { SiteUrls } from "@/lib/signout-chain";

/** Where each Strictly Jayers site lives, from this app's own server config (never from the request). */
export function signoutSiteUrls(): SiteUrls {
  const site = getFitnessSiteConfig();
  return {
    www: site.communitySiteUrl,
    hub: site.fantasyHubUrl,
    fitness: site.siteUrl,
    vibe: site.vibeUrl,
  };
}
