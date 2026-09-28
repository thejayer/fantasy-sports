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

  it("keeps firehose cards content-sized and clips home overflow", () => {
    const css = readFileSync(path.join(APP_DIR, "globals.css"), "utf8");
    expect(css).toMatch(/overflow-x:\s*clip/);
    expect(css).not.toMatch(/\.news-card\s*\{[^}]*min-height:\s*14rem/);
    expect(css).toMatch(/\.watch-stage-player \{[\s\S]*?position:\s*sticky/);
  });
});
