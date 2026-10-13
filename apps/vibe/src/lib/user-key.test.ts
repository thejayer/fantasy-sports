import { describe, expect, it } from "vitest";

import { userKeyFromEmail } from "./user-key";

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
});
