import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const APP_DIR = path.resolve(__dirname, "../app");
const ROOT = path.resolve(__dirname, "../..");

describe("fitness chrome after Phase E audit", () => {
  it("ships Next icon routes and a static favicon", () => {
    expect(existsSync(path.join(APP_DIR, "icon.tsx"))).toBe(true);
    expect(existsSync(path.join(APP_DIR, "apple-icon.tsx"))).toBe(true);
    expect(existsSync(path.join(ROOT, "public/favicon.ico"))).toBe(true);
  });

  it("keeps icon routes outside the session gate", () => {
    const middleware = readFileSync(
      path.join(ROOT, "src/middleware.ts"),
      "utf8",
    );
    expect(middleware).toMatch(/isPublicMetadataPath/);
    expect(middleware).toMatch(/apple-icon/);
  });
});
