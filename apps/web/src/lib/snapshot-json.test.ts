import { describe, expect, it } from "vitest";

import {
  CorruptSnapshotError,
  isNotFoundFsError,
  parseSnapshotJson,
} from "@/lib/snapshot-json";

describe("snapshot JSON helpers", () => {
  it("parses valid JSON", () => {
    expect(parseSnapshotJson<{ a: number }>('{"a":1}', "x.json")).toEqual({ a: 1 });
  });

  it("throws CorruptSnapshotError on invalid JSON", () => {
    expect(() => parseSnapshotJson("not-json", "bad.json")).toThrow(CorruptSnapshotError);
    try {
      parseSnapshotJson("{", "bad.json");
    } catch (err) {
      expect(err).toBeInstanceOf(CorruptSnapshotError);
      expect((err as CorruptSnapshotError).path).toBe("bad.json");
      expect((err as CorruptSnapshotError).message).toMatch(/bad\.json/);
    }
  });

  it("detects ENOENT as missing", () => {
    expect(isNotFoundFsError({ code: "ENOENT" })).toBe(true);
    expect(isNotFoundFsError({ code: "EACCES" })).toBe(false);
    expect(isNotFoundFsError(null)).toBe(false);
  });
});
