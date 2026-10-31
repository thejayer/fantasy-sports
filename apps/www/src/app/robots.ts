import type { MetadataRoute } from "next";

import { getSiteConfig } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const { siteUrl } = getSiteConfig();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/bets", "/casino", "/profile", "/login", "/api/auth"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
