import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const syncSource = readFileSync(
  path.resolve(__dirname, "../../public/sync.js"),
  "utf8",
);

describe("fitness sync client", () => {
  it("loads app.js only after /api/me hydrate", () => {
    expect(syncSource).toContain('fetch("/api/me"');
    expect(syncSource).toContain('script.src = "app.js"');
    expect(syncSource).toContain("migrate");
    expect(syncSource).toContain("athleteLog.sessions.v1");
    expect(syncSource).toContain("storagePrefix");
  });

  it("never sends a client-supplied user id to the store path", () => {
    expect(syncSource).not.toMatch(/body\.email|userId/);
  });
});
