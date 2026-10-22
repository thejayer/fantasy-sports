import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Slim Cloud Run image (apps/www/Dockerfile). Vercel ignores `standalone`
  // and keeps its own output; do not put an output override in vercel.json.
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  serverExternalPackages: [
    "@google-cloud/storage",
    "google-auth-library",
  ],
};

export default nextConfig;
