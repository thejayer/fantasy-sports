import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the slim Cloud Run image (apps/web/Dockerfile).
  output: "standalone",
};

export default nextConfig;
