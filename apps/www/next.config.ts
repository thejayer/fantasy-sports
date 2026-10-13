import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Slim Cloud Run image (apps/www/Dockerfile).
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
