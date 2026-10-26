import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const downloadGcsObject = vi.fn();

vi.mock("@/lib/gcs", () => ({
  downloadGcsObject: (objectKey: string) => downloadGcsObject(objectKey),
}));

const ENV_KEYS = [
  "SJ_DATA_SOURCE",
  "SJ_GCS_PREFIX",
  "SJ_HUB_DIR",
  "SJ_DATA_DIR",
  "SJ_BETS_DIR",
] as const;

const previous = new Map<string, string | undefined>();

function snapshotEnv() {
  previous.clear();
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = previous.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function loadSource() {
  vi.resetModules();
  return import("./data-source");
}

beforeEach(() => {
  snapshotEnv();
  downloadGcsObject.mockReset();
  downloadGcsObject.mockResolvedValue(null);
});

afterEach(() => {
  restoreEnv();
});

describe("dataSourceMode", () => {
  it("defaults to fs so Cloud Run and local stay on the FUSE/fixture path", async () => {
    const { dataSourceMode } = await loadSource();
    expect(dataSourceMode()).toBe("fs");
  });

  it("selects gcs only when SJ_DATA_SOURCE=gcs", async () => {
    process.env.SJ_DATA_SOURCE = "GCS";
    const { dataSourceMode } = await loadSource();
    expect(dataSourceMode()).toBe("gcs");
  });
});

describe("gcsObjectKey", () => {
  it("maps hub and bets files to bucket-root keys by default", async () => {
    const { gcsObjectKey, hubMembersRelPath } = await loadSource();
    expect(gcsObjectKey(hubMembersRelPath())).toBe("hub_members.json");
    expect(gcsObjectKey("bets", "bets.json")).toBe("bets/bets.json");
    expect(gcsObjectKey("bets", "bot/board.json")).toBe("bets/bot/board.json");
  });

  it("prefixes keys when SJ_GCS_PREFIX is set", async () => {
    process.env.SJ_GCS_PREFIX = "/data/sj/";
    const { gcsObjectKey } = await loadSource();
    expect(gcsObjectKey("hub_members.json")).toBe("data/sj/hub_members.json");
    expect(gcsObjectKey("bets", "parlay_legs.json")).toBe(
      "data/sj/bets/parlay_legs.json",
    );
  });
});

describe("readHubText / readBetsText", () => {
  it("reads hub_members.json from SJ_HUB_DIR in fs mode", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sj-hub-"));
    writeFileSync(
      path.join(dir, "hub_members.json"),
      JSON.stringify({ members: [{ email: "ada@example.com" }] }),
    );
    process.env.SJ_HUB_DIR = dir;
    const { readHubText } = await loadSource();
    await expect(readHubText()).resolves.toContain("ada@example.com");
    expect(downloadGcsObject).not.toHaveBeenCalled();
  });

  it("returns null when hub_members.json is missing in fs mode", async () => {
    process.env.SJ_HUB_DIR = mkdtempSync(path.join(tmpdir(), "sj-hub-empty-"));
    const { readHubText } = await loadSource();
    await expect(readHubText()).resolves.toBeNull();
  });

  it("prefers GCS in gcs mode then falls back to local bets fixtures", async () => {
    process.env.SJ_DATA_SOURCE = "gcs";
    downloadGcsObject.mockImplementation(async (key: string) => {
      if (key === "bets/bets.json") return '{"bets":[{"id":"gcs-1","who":"G"}]}';
      return null;
    });
    const { readBetsText, readHubText } = await loadSource();
    await expect(readBetsText("bets.json")).resolves.toContain("gcs-1");
    await expect(readHubText()).resolves.toBeNull();
    expect(downloadGcsObject).toHaveBeenCalledWith("bets/bets.json");
    expect(downloadGcsObject).toHaveBeenCalledWith("hub_members.json");
  });

  it("falls back to SJ_BETS_DIR when the GCS object is missing", async () => {
    process.env.SJ_DATA_SOURCE = "gcs";
    downloadGcsObject.mockResolvedValue(null);
    const dir = mkdtempSync(path.join(tmpdir(), "sj-bets-"));
    writeFileSync(
      path.join(dir, "bets.json"),
      JSON.stringify({ bets: [{ id: "local-1", who: "L" }] }),
    );
    process.env.SJ_BETS_DIR = dir;
    const { readBetsText } = await loadSource();
    await expect(readBetsText("bets.json")).resolves.toContain("local-1");
  });

  it("does not fall back when GCS throws a non-missing error", async () => {
    process.env.SJ_DATA_SOURCE = "gcs";
    downloadGcsObject.mockRejectedValue(
      Object.assign(new Error("forbidden"), { code: 403 }),
    );
    process.env.SJ_BETS_DIR = mkdtempSync(path.join(tmpdir(), "sj-bets-"));
    const { readBetsText } = await loadSource();
    await expect(readBetsText("bets.json")).rejects.toThrow("forbidden");
  });

  it("coalesces concurrent GCS reads of the same object", async () => {
    process.env.SJ_DATA_SOURCE = "gcs";
    downloadGcsObject.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return '{"members":[]}';
    });
    const { readHubText } = await loadSource();
    const [first, second] = await Promise.all([readHubText(), readHubText()]);
    expect(first).toBe('{"members":[]}');
    expect(second).toBe('{"members":[]}');
    expect(downloadGcsObject).toHaveBeenCalledTimes(1);
  });
});
