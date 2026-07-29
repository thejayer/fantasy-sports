import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";

import { hubDataRoot, snapshotDataRoots, dataRoots } from "@/lib/hub-paths";

describe("hub-paths", () => {
  const prevHub = process.env.SJ_HUB_DIR;
  const prevData = process.env.SJ_DATA_DIR;

  afterEach(() => {
    if (prevHub === undefined) delete process.env.SJ_HUB_DIR;
    else process.env.SJ_HUB_DIR = prevHub;
    if (prevData === undefined) delete process.env.SJ_DATA_DIR;
    else process.env.SJ_DATA_DIR = prevData;
  });

  it("defaults hub root beside SJ_DATA_DIR", () => {
    process.env.SJ_DATA_DIR = "/app/data/sj";
    delete process.env.SJ_HUB_DIR;
    expect(hubDataRoot()).toBe(path.resolve("/app/data/hub"));
  });

  it("honors SJ_HUB_DIR over the sibling default", () => {
    process.env.SJ_DATA_DIR = "/app/data/sj";
    process.env.SJ_HUB_DIR = "/mnt/hub";
    expect(hubDataRoot()).toBe("/mnt/hub");
  });

  it("lists hub root before snapshot roots", () => {
    process.env.SJ_HUB_DIR = "/mnt/hub";
    process.env.SJ_DATA_DIR = "/mnt/sj";
    const roots = dataRoots();
    expect(roots[0]).toBe("/mnt/hub");
    expect(roots).toContain("/mnt/sj");
    expect(snapshotDataRoots()[0]).toBe("/mnt/sj");
    expect(snapshotDataRoots()).not.toContain("/mnt/hub");
  });
});
