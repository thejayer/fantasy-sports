#!/usr/bin/env node
/**
 * Fail the build if any content route was statically prerendered.
 *
 * League snapshots live on a Cloud Storage mount that only exists at runtime;
 * the image is built with just `fixtures/sj`. Anything prerendered therefore
 * bakes in sample data permanently, which is exactly the bug that shipped for
 * `/` and `/leagues`. `next dev` re-renders every request, so this is only
 * observable in a production build -- hence a build-time assertion.
 *
 * Run after `next build`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const MANIFEST = path.resolve(process.cwd(), ".next/prerender-manifest.json");

// Routes that render no snapshot data and are safe to prerender.
const ALLOWED_PRERENDERED = new Set([
  "/_not-found",
  "/favicon.ico",
  // Metadata routes (roadmap 3.6) — static by design, no snapshot reads.
  "/robots.txt",
  "/manifest.webmanifest",
  "/opengraph-image",
]);

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
} catch (error) {
  console.error(`Could not read ${MANIFEST}. Run \`next build\` first.`);
  console.error(String(error));
  process.exit(1);
}

const prerendered = Object.keys(manifest.routes ?? {});
const offenders = prerendered.filter((route) => !ALLOWED_PRERENDERED.has(route));

if (offenders.length > 0) {
  console.error("Statically prerendered content routes detected:\n");
  for (const route of offenders) {
    console.error(`  ${route}`);
  }
  console.error(
    "\nThese would serve build-time fixture data forever, ignoring sj-sync.\n" +
      'Add `export const dynamic = "force-dynamic"` to the page, or add the\n' +
      "route to ALLOWED_PRERENDERED if it genuinely reads no snapshot data.",
  );
  process.exit(1);
}

console.log(
  `prerender check ok: ${prerendered.length} prerendered route(s), all allowlisted ` +
    `(${[...ALLOWED_PRERENDERED].join(", ")})`,
);
