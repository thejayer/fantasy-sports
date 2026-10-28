import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getBetsActor = vi.fn();
const downloadGcsObject = vi.fn();

vi.mock("@/lib/session", () => ({
  getBetsActor: () => getBetsActor(),
}));

vi.mock("@/lib/gcs", () => ({
  downloadGcsObject: (objectKey: string) => downloadGcsObject(objectKey),
}));

async function loadStore() {
  vi.resetModules();
  return import("./bets-store");
}

beforeEach(() => {
  getBetsActor.mockReset();
  downloadGcsObject.mockReset();
  downloadGcsObject.mockResolvedValue(null);
});

afterEach(() => {
  getBetsActor.mockReset();
  downloadGcsObject.mockReset();
});

describe("getBetsDocument", () => {
  const previousBetsDir = process.env.SJ_BETS_DIR;
  const previousSource = process.env.SJ_DATA_SOURCE;

  afterEach(() => {
    if (previousBetsDir === undefined) delete process.env.SJ_BETS_DIR;
    else process.env.SJ_BETS_DIR = previousBetsDir;
    if (previousSource === undefined) delete process.env.SJ_DATA_SOURCE;
    else process.env.SJ_DATA_SOURCE = previousSource;
  });

  it("returns empty when there is no allowlisted actor", async () => {
    getBetsActor.mockResolvedValue(null);
    const {
      getBetsDocument,
      getParlayDocument,
      getPublicDocument,
      getSplitsDocument,
      getTailingDocument,
      getOptionsDocument,
    } = await loadStore();
    await expect(getBetsDocument()).resolves.toEqual({ bets: [] });
    await expect(getParlayDocument()).resolves.toEqual({ legs: [] });
    await expect(getPublicDocument()).resolves.toEqual({ warnings: [] });
    await expect(getSplitsDocument()).resolves.toEqual({ splits: [], sports: [], checks: [] });
    await expect(getTailingDocument()).resolves.toEqual({ views: [], legs: [] });
    await expect(getOptionsDocument()).resolves.toEqual({ trades: [], traders: [] });
  });

  it("treats corrupt JSON as empty so one file cannot 500 the board", async () => {
    getBetsActor.mockResolvedValue({ email: "demo@example.com", source: "bypass" });
    const dir = mkdtempSync(path.join(tmpdir(), "sj-bets-"));
    writeFileSync(path.join(dir, "bets.json"), JSON.stringify({ bets: [{ id: "T-1", who: "Trent" }] }));
    writeFileSync(path.join(dir, "parlay_legs.json"), "{not-json");
    writeFileSync(path.join(dir, "public_warnings.json"), "[]");
    writeFileSync(path.join(dir, "record_splits.json"), "{not-json");
    writeFileSync(path.join(dir, "tailing_legs.json"), "{not-json");
    writeFileSync(path.join(dir, "options.json"), "{not-json");
    process.env.SJ_BETS_DIR = dir;
    const {
      getBetsDocument,
      getParlayDocument,
      getPublicDocument,
      getSplitsDocument,
      getTailingDocument,
      getOptionsDocument,
    } = await loadStore();
    await expect(getBetsDocument()).resolves.toMatchObject({
      bets: [{ id: "T-1", who: "Trent" }],
    });
    await expect(getParlayDocument()).resolves.toEqual({ legs: [] });
    await expect(getPublicDocument()).resolves.toEqual({ warnings: [] });
    await expect(getSplitsDocument()).resolves.toEqual({ splits: [], sports: [], checks: [] });
    await expect(getTailingDocument()).resolves.toEqual({ views: [], legs: [] });
    await expect(getOptionsDocument()).resolves.toEqual({ trades: [], traders: [] });
    expect(downloadGcsObject).not.toHaveBeenCalled();
  });

  it("reads bets.json from GCS when SJ_DATA_SOURCE=gcs", async () => {
    getBetsActor.mockResolvedValue({ email: "demo@example.com", source: "bypass" });
    process.env.SJ_DATA_SOURCE = "gcs";
    downloadGcsObject.mockImplementation(async (key: string) => {
      if (key === "bets/bets.json") {
        return JSON.stringify({ bets: [{ id: "gcs-1", who: "Gcs" }] });
      }
      return null;
    });
    const { getBetsDocument } = await loadStore();
    await expect(getBetsDocument()).resolves.toMatchObject({
      bets: [{ id: "gcs-1", who: "Gcs" }],
    });
    expect(downloadGcsObject).toHaveBeenCalledWith("bets/bets.json");
  });

  it("reads options.json from GCS when SJ_DATA_SOURCE=gcs", async () => {
    getBetsActor.mockResolvedValue({ email: "demo@example.com", source: "bypass" });
    process.env.SJ_DATA_SOURCE = "gcs";
    downloadGcsObject.mockImplementation(async (key: string) => {
      if (key === "bets/options.json") {
        return JSON.stringify({
          trades: [{ id: "O-1", trader: "Sample Trader A" }],
          traders: [{ name: "Sample Trader A", trades: 1, pl: 0, wins: 0, losses: 0, open: 0, has_daily_recap: false }],
        });
      }
      return null;
    });
    const { getOptionsDocument } = await loadStore();
    await expect(getOptionsDocument()).resolves.toMatchObject({
      trades: [{ id: "O-1", trader: "Sample Trader A" }],
    });
    expect(downloadGcsObject).toHaveBeenCalledWith("bets/options.json");
  });
});
