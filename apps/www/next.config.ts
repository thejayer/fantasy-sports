import type { NextConfig } from "next";

import { casinoRewrites } from "./src/lib/casino";

const nextConfig: NextConfig = {
  // Slim Cloud Run image (apps/www/Dockerfile). Vercel ignores `standalone`
  // and keeps its own output; do not put an output override in vercel.json.
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  serverExternalPackages: [
    "@google-cloud/storage",
    "google-auth-library",
  ],
  // Optional /casino proxy. Rewrites (not redirects) so the browser stays on
  // strictlyjayers.com/casino. Image extensions skip middleware, so this is
  // also what forwards /casino/*.png — CASINO_URL is read at build time.
  async rewrites() {
    return casinoRewrites();
  },
};

export default nextConfig;
