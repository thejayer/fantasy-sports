import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const APP_DIR = path.resolve(__dirname);
const WEB_ROOT = path.resolve(__dirname, "../..");
const PUBLIC_DIR = path.join(WEB_ROOT, "public");

describe("roadmap 3.6 polish surface", () => {
  it("ships loading skeletons for hub routes", () => {
    for (const relative of [
      "loading.tsx",
      "leagues/loading.tsx",
      "leagues/[leagueId]/loading.tsx",
    ]) {
      expect(existsSync(path.join(APP_DIR, relative))).toBe(true);
    }
    const loading = readFileSync(path.join(APP_DIR, "loading.tsx"), "utf8");
    expect(loading).toMatch(/LoadingSkeleton/);
  });

  it("exposes robots, manifest, and opengraph image modules", () => {
    expect(existsSync(path.join(APP_DIR, "robots.ts"))).toBe(true);
    expect(existsSync(path.join(APP_DIR, "manifest.ts"))).toBe(true);
    expect(existsSync(path.join(APP_DIR, "opengraph-image.tsx"))).toBe(true);
  });

  it("removes create-next-app boilerplate SVGs", () => {
    // Keep public/ present (Docker COPY needs the directory) via .gitkeep only.
    const names = existsSync(PUBLIC_DIR) ? readdirSync(PUBLIC_DIR) : [];
    expect(names.filter((name) => name.endsWith(".svg"))).toEqual([]);
    expect(names).toContain(".gitkeep");
  });

  it("distinguishes corrupt snapshots in readJson wiring", () => {
    const data = readFileSync(path.join(APP_DIR, "../lib/data.ts"), "utf8");
    expect(data).toMatch(/CorruptSnapshotError/);
    expect(data).toMatch(/parseSnapshotJson/);
    expect(data).toMatch(/isNotFoundFsError/);
  });

  it("uses Next Data Cache tags instead of a process-local Map", () => {
    const data = readFileSync(path.join(APP_DIR, "../lib/data.ts"), "utf8");
    expect(data).toMatch(/unstable_cache/);
    expect(data).toMatch(/SJ_SNAPSHOTS_CACHE_TAG/);
    expect(data).not.toMatch(/\bfileCache\b/);
    expect(existsSync(path.join(APP_DIR, "api/revalidate/route.ts"))).toBe(true);
  });
});
