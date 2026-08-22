import { describe, expect, it } from "vitest";

import { storagePrefixForEmail, userKeyFromEmail } from "./user-key";

describe("userKeyFromEmail", () => {
  it("is stable and case-insensitive", () => {
    expect(userKeyFromEmail("Ada@Sj.com")).toBe(userKeyFromEmail("ada@sj.com"));
  });

  it("differs per member", () => {
    expect(userKeyFromEmail("ada@sj.com")).not.toBe(
      userKeyFromEmail("bob@sj.com"),
    );
  });

  it("is a 32-char hex path segment", () => {
    expect(userKeyFromEmail("ada@sj.com")).toMatch(/^[a-f0-9]{32}$/);
  });

  it("namespaces localStorage away from the anonymous athleteLog.* keys", () => {
    expect(storagePrefixForEmail("ada@sj.com")).toMatch(/^athleteLog\.[a-f0-9]{32}$/);
    expect(storagePrefixForEmail("ada@sj.com")).not.toBe("athleteLog");
  });
});
