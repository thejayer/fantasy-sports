import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const APP_DIR = path.resolve(__dirname, "../app");
const WWW_ROOT = path.resolve(__dirname, "../..");

describe("portal chrome after Phase E audit", () => {
  it("ships Next icon routes and a static favicon", () => {
    expect(existsSync(path.join(APP_DIR, "icon.tsx"))).toBe(true);
    expect(existsSync(path.join(APP_DIR, "apple-icon.tsx"))).toBe(true);
    expect(existsSync(path.join(WWW_ROOT, "public/favicon.ico"))).toBe(true);
  });

  it("renders X profile cards without widgets.js embeds", () => {
    const source = readFileSync(
      path.join(WWW_ROOT, "src/components/XTimeline.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/platform\.twitter\.com/);
    expect(source).not.toMatch(/twitter-timeline/);
    expect(source).toMatch(/Open on X/);
  });

  it("documents the Vercel pilot without a vercel.json output override", () => {
    expect(existsSync(path.join(WWW_ROOT, "VERCEL.md"))).toBe(true);
    expect(existsSync(path.join(WWW_ROOT, "scripts/vercel-ignore.sh"))).toBe(
      true,
    );
    expect(existsSync(path.join(WWW_ROOT, "vercel.json"))).toBe(false);
    const nextConfig = readFileSync(path.join(WWW_ROOT, "next.config.ts"), "utf8");
    expect(nextConfig).toMatch(/output:\s*"standalone"/);
    const vercelMd = readFileSync(path.join(WWW_ROOT, "VERCEL.md"), "utf8");
    expect(vercelMd).toMatch(/Root Directory/);
    expect(vercelMd).toMatch(/scripts\/vercel-ignore\.sh/);
    expect(vercelMd).toMatch(/\/api\/auth\/callback\/google/);
    expect(vercelMd).not.toMatch(/iam\.gserviceaccount\.com/);
    expect(vercelMd).not.toMatch(/gs:\/\//);
  });

  it("does not ship a service worker on the apex", () => {
    const files = [
      path.join(WWW_ROOT, "public/service-worker.js"),
      path.join(WWW_ROOT, "public/sw.js"),
      path.join(APP_DIR, "bets"),
    ];
    expect(existsSync(files[0])).toBe(false);
    expect(existsSync(files[1])).toBe(false);
    expect(existsSync(path.join(APP_DIR, "bets/page.tsx"))).toBe(true);
  });

  it("keeps firehose cards content-sized and clips home overflow", () => {
    const css = readFileSync(path.join(APP_DIR, "globals.css"), "utf8");
    expect(css).toMatch(/overflow-x:\s*clip/);
    expect(css).not.toMatch(/\.news-card\s*\{[^}]*min-height:\s*14rem/);
    expect(css).toMatch(/\.watch-stage-player \{[\s\S]*?position:\s*sticky/);
  });
});
