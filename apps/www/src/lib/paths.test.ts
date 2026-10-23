import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { betsDataRoots, hubDataRoot } from "./paths";

const ENV_KEYS = ["SJ_HUB_DIR", "SJ_DATA_DIR", "SJ_BETS_DIR"] as const;
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

beforeEach(snapshotEnv);
afterEach(restoreEnv);

describe("hubDataRoot", () => {
  it("prefers SJ_HUB_DIR", () => {
    process.env.SJ_HUB_DIR = "/app/data/sj";
    process.env.SJ_DATA_DIR = "/other";
    expect(hubDataRoot()).toBe("/app/data/sj");
  });

  it("falls back to SJ_DATA_DIR then ../../data/sj", () => {
    process.env.SJ_DATA_DIR = "/mnt/data";
    expect(hubDataRoot()).toBe(path.resolve("/mnt/data"));
    delete process.env.SJ_DATA_DIR;
    expect(hubDataRoot()).toBe(path.resolve(process.cwd(), "../../data/sj"));
  });
});

describe("betsDataRoots", () => {
  it("searches override, hub, data, then committed fixtures", () => {
    process.env.SJ_BETS_DIR = "/tmp/bets";
    process.env.SJ_HUB_DIR = "/app/data/sj";
    process.env.SJ_DATA_DIR = "/mnt/data";
    const roots = betsDataRoots();
    expect(roots[0]).toBe("/tmp/bets");
    expect(roots[1]).toBe(path.join("/app/data/sj", "bets"));
    expect(roots[2]).toBe(path.join("/mnt/data", "bets"));
    expect(roots.some((root) => root.endsWith(path.join("fixtures", "bets")))).toBe(
      true,
    );
  });
});
