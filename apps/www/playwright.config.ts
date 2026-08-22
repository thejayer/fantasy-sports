import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const port = Number(process.env.PORT ?? 3002);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const appRoot = __dirname;
const standaloneRoot = path.resolve(appRoot, ".next/standalone");
const standaloneServer = path.join(standaloneRoot, "server.js");

/**
 * Tiny portal smoke (roadmap P.7). Starts the same standalone server.js the
 * Dockerfile uses (after copying `.next/static` beside it).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: [
      `mkdir -p "${path.join(standaloneRoot, ".next")}"`,
      `cp -R "${path.join(appRoot, ".next/static")}" "${path.join(standaloneRoot, ".next/static")}"`,
      // Standalone nests the app under apps/www when built from the monorepo.
      `if [ -d "${path.join(standaloneRoot, "apps/www/public")}" ]; then ` +
        `cp -R "${path.join(appRoot, "public")}/." "${path.join(standaloneRoot, "apps/www/public")}/"; ` +
        `fi`,
      `cp -R "${path.join(appRoot, "public")}" "${path.join(standaloneRoot, "public")}" 2>/dev/null || true`,
      `node "${standaloneServer}"`,
    ].join(" && "),
    cwd: standaloneRoot,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      SITE_URL: baseURL,
      FANTASY_HUB_URL:
        process.env.FANTASY_HUB_URL ?? "https://fantasy.strictlyjayers.com",
      FITNESS_URL:
        process.env.FITNESS_URL ?? "https://fitness.strictlyjayers.com",
      DISCORD_INVITE_URL:
        process.env.DISCORD_INVITE_URL ?? "https://discord.gg/example",
    },
  },
});
