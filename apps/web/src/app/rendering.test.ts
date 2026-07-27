import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guards the staleness bug that shipped to production: `/` and `/leagues` were
 * statically prerendered, and because the image is built with only
 * `fixtures/sj` present, they baked those fixtures in permanently while the
 * real snapshots arrived later on a runtime Cloud Storage mount.
 *
 * Nothing about that is visible in `next dev`, which re-renders every request,
 * so it needs a test rather than review attention.
 */

const APP_DIR = path.resolve(__dirname);

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    return entry.name === "page.tsx" ? [full] : [];
  });
}

const pagesReadingSnapshots = pageFiles(APP_DIR)
  .map((file) => ({ file, source: readFileSync(file, "utf8") }))
  .filter(({ source }) => source.includes("@/lib/data"));

describe("snapshot-backed pages opt out of prerendering", () => {
  it("finds the pages that read snapshot data", () => {
    const relative = pagesReadingSnapshots
      .map(({ file }) => path.relative(APP_DIR, file))
      .sort();
    expect(relative).toEqual([
      "leagues/[leagueId]/page.tsx",
      "leagues/[leagueId]/teams/[teamId]/page.tsx",
      "leagues/page.tsx",
      "page.tsx",
    ]);
  });

  it.each(pagesReadingSnapshots.map(({ file, source }) => [path.relative(APP_DIR, file), source]))(
    "%s declares force-dynamic",
    (_relative, source) => {
      expect(source).toMatch(/export const dynamic\s*=\s*"force-dynamic"/);
    },
  );

  it("has no page reading snapshots without the declaration", () => {
    const missing = pagesReadingSnapshots
      .filter(({ source }) => !/export const dynamic\s*=\s*"force-dynamic"/.test(source))
      .map(({ file }) => path.relative(APP_DIR, file));
    expect(missing).toEqual([]);
  });
});
