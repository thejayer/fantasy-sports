#!/usr/bin/env node
/**
 * Fail the build when App Router client bundles exceed gzip budgets.
 *
 * Next 15 / webpack left `.next/app-build-manifest.json` with per-route file
 * lists. Next 16 defaults to Turbopack and no longer writes that file, so we
 * derive First Load sets from each route's `page/build-manifest.json` (shared
 * runtime) plus `*_client-reference-manifest.js` (route client chunks).
 *
 * Budgets are intentionally loose vs today's ~660 kB gzip First Load — they
 * catch accidental dependency bloat, not micro-regressions.
 *
 * Env overrides (bytes, gzipped):
 *   SJ_BUNDLE_ROUTE_BUDGET_GZ  default 850000 (~830 KiB)
 *   SJ_BUNDLE_CHUNKS_BUDGET_GZ  default 1500000 (~1.4 MiB) for all static chunks
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import process from "node:process";

const ROOT = process.cwd();
const LEGACY_MANIFEST = path.join(ROOT, ".next/app-build-manifest.json");
const SERVER_APP = path.join(ROOT, ".next/server/app");
const CHUNKS_DIR = path.join(ROOT, ".next/static/chunks");

const ROUTE_BUDGET = Number(process.env.SJ_BUNDLE_ROUTE_BUDGET_GZ ?? 850_000);
const CHUNKS_BUDGET = Number(process.env.SJ_BUNDLE_CHUNKS_BUDGET_GZ ?? 1_500_000);

function gzipSize(filePath) {
  return gzipSync(readFileSync(filePath)).length;
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function normalizeChunkRel(rel) {
  // client-reference manifests use "/_next/static/chunks/…";
  // build-manifest uses "static/chunks/…".
  return rel.replace(/^\/_next\//, "").replace(/^\//, "");
}

function sumGzip(files) {
  let total = 0;
  const seen = new Set();
  for (const rel of files) {
    const norm = normalizeChunkRel(rel);
    if (!norm.endsWith(".js") || seen.has(norm)) continue;
    seen.add(norm);
    const abs = path.join(ROOT, ".next", norm);
    if (!existsSync(abs)) continue;
    total += gzipSize(abs);
  }
  return total;
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, acc);
    else acc.push(abs);
  }
  return acc;
}

/**
 * Parse `globalThis.__RSC_MANIFEST["…"] = {…};` emitted next to each page.
 * @returns {string[]}
 */
function chunksFromClientReferenceManifest(filePath) {
  const text = readFileSync(filePath, "utf8");
  const chunks = new Set();
  for (const match of text.matchAll(/"chunks":\[([^\]]*)\]/g)) {
    for (const chunk of match[1].matchAll(/"([^"]+)"/g)) {
      chunks.add(chunk[1]);
    }
  }
  return [...chunks];
}

/** @returns {Record<string, string[]>} route → relative chunk paths */
function pagesFromLegacyManifest() {
  const manifest = JSON.parse(readFileSync(LEGACY_MANIFEST, "utf8"));
  return manifest.pages ?? {};
}

/**
 * Turbopack layout (Next 16+):
 *   .next/server/app/leagues/[leagueId]/page_client-reference-manifest.js
 *   .next/server/app/leagues/[leagueId]/page/build-manifest.json
 *   .next/server/app/page_client-reference-manifest.js  (home)
 *   .next/server/app/page/build-manifest.json
 *
 * @returns {Record<string, string[]>}
 */
function pagesFromTurbopack() {
  if (!existsSync(SERVER_APP)) {
    console.error(`Missing ${SERVER_APP}. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const pages = {};
  for (const clientPath of walk(SERVER_APP)) {
    if (!clientPath.endsWith("page_client-reference-manifest.js")) continue;

    const dir = path.dirname(clientPath);
    const relDir = path.relative(SERVER_APP, dir).replace(/\\/g, "/");
    const route = relDir === "" ? "/" : `/${relDir}`;

    // Skip framework shells that are not product First Load.
    if (route === "/_not-found" || route === "/_global-error") continue;

    const pageBuild = path.join(dir, "page", "build-manifest.json");
    const shared = [];
    if (existsSync(pageBuild)) {
      const bm = JSON.parse(readFileSync(pageBuild, "utf8"));
      shared.push(...(bm.polyfillFiles ?? []), ...(bm.rootMainFiles ?? []));
    }

    pages[route] = [...shared, ...chunksFromClientReferenceManifest(clientPath)];
  }

  return pages;
}

let pages;
if (existsSync(LEGACY_MANIFEST)) {
  pages = pagesFromLegacyManifest();
} else {
  pages = pagesFromTurbopack();
  if (Object.keys(pages).length === 0) {
    console.error(
      "No route bundles found (missing app-build-manifest.json and Turbopack " +
        "client-reference manifests). Run `npm run build` first.",
    );
    process.exit(1);
  }
}

const failures = [];

console.log(`Route gzip budget: ${formatKb(ROUTE_BUDGET)}`);
for (const [route, files] of Object.entries(pages)) {
  const total = sumGzip(files);
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
