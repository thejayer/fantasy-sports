#!/usr/bin/env node
/**
 * Fail CI when fixture HTML documents exceed the payload budget (roadmap 7.11).
 *
 * Starts the standalone server against committed fixtures (AUTH_DEV_BYPASS),
 * fetches the historically heavy routes, and asserts raw document bytes stay
 * under SJ_HTML_BUDGET_BYTES (default 100_000).
 *
 * Env:
 *   SJ_HTML_BUDGET_BYTES   default 100000
 *   SJ_HTML_BUDGET_PORT    default 3456
 *   SJ_HTML_BUDGET_ROUTES  comma-separated paths (optional override)
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = process.cwd();
const STANDALONE = path.join(ROOT, ".next/standalone");
const SERVER = path.join(STANDALONE, "server.js");
const FIXTURES = path.resolve(ROOT, "../../fixtures/sj");
const HUB = path.join(ROOT, ".html-budget-hub-data");

const BUDGET = Number(process.env.SJ_HTML_BUDGET_BYTES ?? 100_000);
const PORT = Number(process.env.SJ_HTML_BUDGET_PORT ?? 3456);
const BASE = `http://127.0.0.1:${PORT}`;

const DEFAULT_ROUTES = [
  "/leagues/baseball-dynasty?tab=players",
  "/leagues/golf-main?tab=scoreboard",
  "/leagues/golf-main?tab=draft",
  "/leagues/football-main?tab=players",
  "/leagues/football-main?tab=tools&view=trade",
];

const ROUTES = (process.env.SJ_HTML_BUDGET_ROUTES ?? DEFAULT_ROUTES.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

if (!existsSync(SERVER)) {
  console.error(`Missing ${SERVER}. Run \`npm run build\` first.`);
  process.exit(1);
}

const staticSrc = path.join(ROOT, ".next/static");
const staticDst = path.join(STANDALONE, ".next/static");
if (!existsSync(staticDst) && existsSync(staticSrc)) {
  const { cpSync, mkdirSync } = await import("node:fs");
  mkdirSync(path.dirname(staticDst), { recursive: true });
  cpSync(staticSrc, staticDst, { recursive: true });
}

const { mkdirSync } = await import("node:fs");
mkdirSync(HUB, { recursive: true });

const child = spawn(process.execPath, [SERVER], {
  cwd: STANDALONE,
  env: {
    ...process.env,
    AUTH_DEV_BYPASS: "1",
    AUTH_SECRET: process.env.AUTH_SECRET ?? "html-budget-secret",
    AUTH_URL: BASE,
    HOSTNAME: "127.0.0.1",
    PORT: String(PORT),
    SJ_DATA_DIR: process.env.SJ_DATA_DIR ?? FIXTURES,
    SJ_HUB_DIR: process.env.SJ_HUB_DIR ?? HUB,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
child.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});

async function waitForHealth(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode != null) {
      throw new Error(`server exited early (${child.exitCode})\n${serverLog}`);
    }
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok || res.status === 503) return;
    } catch {
      // still booting
    }
    await sleep(250);
  }
  throw new Error(`server health check timed out\n${serverLog}`);
}

async function measure(route) {
  const res = await fetch(`${BASE}${route}`, {
    headers: { "Accept-Encoding": "identity" },
  });
  if (!res.ok) {
    throw new Error(`${route} → HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length;
}

let failures = [];
try {
  await waitForHealth();
  console.log(`HTML document budget: ${formatKb(BUDGET)}`);
  for (const route of ROUTES) {
    const bytes = await measure(route);
    const ok = bytes <= BUDGET;
    console.log(`  ${ok ? "ok" : "FAIL"}  ${formatKb(bytes)}  ${route}`);
    if (!ok) {
      failures.push(`${route} is ${formatKb(bytes)} (budget ${formatKb(BUDGET)})`);
    }
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  failures.push("html budget measurement failed");
} finally {
  child.kill("SIGTERM");
  // Give standalone a moment; force if needed.
  await sleep(300);
  if (child.exitCode == null) child.kill("SIGKILL");
}

if (failures.length) {
  console.error("\nHTML budget exceeded:\n");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}

console.log("\nhtml budget ok");
