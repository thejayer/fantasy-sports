import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const downloadGcsObject = vi.fn();

vi.mock("@/lib/gcs", () => ({
  downloadGcsObject: (objectKey: string) => downloadGcsObject(objectKey),
}));

const ENV_KEYS = ["SJ_DATA_SOURCE", "SJ_HUB_DIR", "SJ_GCS_PREFIX"] as const;
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

async function loadStore() {
  vi.resetModules();
  return import("./members-store");
}

beforeEach(() => {
  snapshotEnv();
  downloadGcsObject.mockReset();
  downloadGcsObject.mockResolvedValue(null);
});

afterEach(() => {
  restoreEnv();
});

describe("readHubMembers", () => {
  it("returns members from the hub JSON file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sj-members-"));
    writeFileSync(
      path.join(dir, "hub_members.json"),
      JSON.stringify({ members: [{ email: "file@example.com" }] }),
    );
    process.env.SJ_HUB_DIR = dir;
    const { readHubMembers, hubMembersPath } = await loadStore();
    expect(hubMembersPath()).toBe(path.join(dir, "hub_members.json"));
    await expect(readHubMembers()).resolves.toEqual({
      members: [{ email: "file@example.com" }],
    });
  });

  it("returns null when the file is missing", async () => {
    process.env.SJ_HUB_DIR = mkdtempSync(path.join(tmpdir(), "sj-members-empty-"));
    const { readHubMembers } = await loadStore();
    await expect(readHubMembers()).resolves.toBeNull();
  });

  it("normalizes a file without a members array", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sj-members-"));
    writeFileSync(path.join(dir, "hub_members.json"), JSON.stringify({}));
    process.env.SJ_HUB_DIR = dir;
    const { readHubMembers } = await loadStore();
    await expect(readHubMembers()).resolves.toEqual({ members: [] });
  });

  it("throws on corrupt JSON so auth-gate can fail closed to env-only", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sj-members-"));
    writeFileSync(path.join(dir, "hub_members.json"), "{not-json");
    process.env.SJ_HUB_DIR = dir;
    const { readHubMembers } = await loadStore();
    await expect(readHubMembers()).rejects.toThrow();
  });

  it("reads hub_members.json from GCS in gcs mode", async () => {
    process.env.SJ_DATA_SOURCE = "gcs";
    downloadGcsObject.mockResolvedValue(
      JSON.stringify({ members: [{ email: "gcs@example.com" }] }),
    );
    const { readHubMembers } = await loadStore();
    await expect(readHubMembers()).resolves.toEqual({
      members: [{ email: "gcs@example.com" }],
    });
    expect(downloadGcsObject).toHaveBeenCalledWith("hub_members.json");
  });
});
