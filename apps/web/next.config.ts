import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the slim Cloud Run image (apps/web/Dockerfile).
  output: "standalone",
  // Cloud agent / Playwright often hit the hub via 127.0.0.1 while Next
  // binds to localhost — allow both so /_next HMR + client hydration work.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
