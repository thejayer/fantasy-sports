import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const port = Number(process.env.PORT ?? 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const appRoot = __dirname;
const fixturesDir = path.resolve(appRoot, "../../fixtures/sj");
const hubDir = path.resolve(appRoot, ".playwright-hub-data");
const standaloneRoot = path.resolve(appRoot, ".next/standalone");
const standaloneServer = path.join(standaloneRoot, "server.js");

/**
 * Smoke harness (roadmap 1.2). Defaults to AUTH_DEV_BYPASS=1 so fixture pages
 * are reachable without Google OAuth. Auth-redirect specs set AUTH_DEV_BYPASS=0
 * via the npm script / CI env before starting this config's webServer.
 *
 * SJ_DATA_DIR points at committed fixtures so a local data/sj seed cannot make
 * assertions flake. SJ_HUB_DIR is a writable sidecar for golf/members so create
 * flows never mutate fixtures/sj. Starts the same standalone server.js the
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
      `node "${standaloneServer}"`,
    ].join(" && "),
    cwd: standaloneRoot,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      AUTH_DEV_BYPASS: process.env.AUTH_DEV_BYPASS ?? "1",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "ci-smoke-secret",
      AUTH_URL: baseURL,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      SJ_DATA_DIR: process.env.SJ_DATA_DIR ?? fixturesDir,
      SJ_HUB_DIR: process.env.SJ_HUB_DIR ?? hubDir,
    },
  },
});
