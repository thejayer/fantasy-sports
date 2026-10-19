import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getBetsActor = vi.fn();

vi.mock("@/lib/session", () => ({
  getBetsActor: () => getBetsActor(),
}));

async function loadStore() {
  vi.resetModules();
  return import("./bets-store");
}

beforeEach(() => {
  getBetsActor.mockReset();
});

afterEach(() => {
  getBetsActor.mockReset();
});

describe("getBetsDocument", () => {
  const previousBetsDir = process.env.SJ_BETS_DIR;

  afterEach(() => {
    if (previousBetsDir === undefined) delete process.env.SJ_BETS_DIR;
    else process.env.SJ_BETS_DIR = previousBetsDir;
  });

  it("returns empty when there is no allowlisted actor", async () => {
    getBetsActor.mockResolvedValue(null);
    const { getBetsDocument, getParlayDocument, getPublicDocument, getSplitsDocument } =
      await loadStore();
    await expect(getBetsDocument()).resolves.toEqual({ bets: [] });
    await expect(getParlayDocument()).resolves.toEqual({ legs: [] });
    await expect(getPublicDocument()).resolves.toEqual({ warnings: [] });
    await expect(getSplitsDocument()).resolves.toEqual({ splits: [], sports: [], checks: [] });
  });

  it("treats corrupt JSON as empty so one file cannot 500 the board", async () => {
    getBetsActor.mockResolvedValue({ email: "demo@example.com", source: "bypass" });
    const dir = mkdtempSync(path.join(tmpdir(), "sj-bets-"));
    writeFileSync(path.join(dir, "bets.json"), JSON.stringify({ bets: [{ id: "T-1", who: "Trent" }] }));
    writeFileSync(path.join(dir, "parlay_legs.json"), "{not-json");
    writeFileSync(path.join(dir, "public_warnings.json"), "[]");
    writeFileSync(path.join(dir, "record_splits.json"), "{not-json");
    process.env.SJ_BETS_DIR = dir;
    const { getBetsDocument, getParlayDocument, getPublicDocument, getSplitsDocument } =
      await loadStore();
    await expect(getBetsDocument()).resolves.toMatchObject({
      bets: [{ id: "T-1", who: "Trent" }],
    });
    await expect(getParlayDocument()).resolves.toEqual({ legs: [] });
    await expect(getPublicDocument()).resolves.toEqual({ warnings: [] });
    await expect(getSplitsDocument()).resolves.toEqual({ splits: [], sports: [], checks: [] });
  });
});
