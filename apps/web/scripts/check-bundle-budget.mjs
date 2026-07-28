#!/usr/bin/env node
/**
 * Fail the build when App Router client bundles exceed gzip budgets.
 *
 * Reads `.next/app-build-manifest.json` (run after `next build`). Budgets are
 * intentionally loose vs today's ~660 kB gzip First Load — they catch
 * accidental dependency bloat, not micro-regressions.
 *
 * Env overrides (bytes, gzipped):
 *   SJ_BUNDLE_ROUTE_BUDGET_GZ  default 850000 (~830 KiB)
 *   SJ_BUNDLE_CHUNKS_BUDGET_GZ  default 1500000 (~1.4 MiB) for all static chunks
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import process from "node:process";

const ROOT = process.cwd();
const MANIFEST = path.join(ROOT, ".next/app-build-manifest.json");
const CHUNKS_DIR = path.join(ROOT, ".next/static/chunks");

const ROUTE_BUDGET = Number(process.env.SJ_BUNDLE_ROUTE_BUDGET_GZ ?? 850_000);
const CHUNKS_BUDGET = Number(process.env.SJ_BUNDLE_CHUNKS_BUDGET_GZ ?? 1_500_000);

function gzipSize(filePath) {
  return gzipSync(readFileSync(filePath)).length;
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

if (!existsSync(MANIFEST)) {
  console.error(`Missing ${MANIFEST}. Run \`npm run build\` first.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const pages = manifest.pages ?? {};
const failures = [];

console.log(`Route gzip budget: ${formatKb(ROUTE_BUDGET)}`);
for (const [route, files] of Object.entries(pages)) {
  let total = 0;
  for (const rel of files) {
    const abs = path.join(ROOT, ".next", rel);
    if (!existsSync(abs)) continue;
    total += gzipSize(abs);
  }
  const ok = total <= ROUTE_BUDGET;
  console.log(`  ${ok ? "ok" : "FAIL"}  ${route}: ${formatKb(total)}`);
  if (!ok) {
    failures.push(`${route} is ${formatKb(total)} (budget ${formatKb(ROUTE_BUDGET)})`);
  }
}

if (!existsSync(CHUNKS_DIR)) {
  console.error(`Missing ${CHUNKS_DIR}`);
  process.exit(1);
}

let chunksTotal = 0;
for (const name of readdirSync(CHUNKS_DIR)) {
  if (!name.endsWith(".js")) continue;
  chunksTotal += gzipSize(path.join(CHUNKS_DIR, name));
}
console.log(`All static chunks gzip budget: ${formatKb(CHUNKS_BUDGET)}`);
console.log(
  `  ${chunksTotal <= CHUNKS_BUDGET ? "ok" : "FAIL"}  .next/static/chunks: ${formatKb(chunksTotal)}`,
);
if (chunksTotal > CHUNKS_BUDGET) {
  failures.push(
    `static/chunks is ${formatKb(chunksTotal)} (budget ${formatKb(CHUNKS_BUDGET)})`,
  );
}

if (failures.length) {
  console.error("\nBundle budget exceeded:\n");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}

console.log("\nbundle budget ok");
