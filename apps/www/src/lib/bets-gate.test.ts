import { describe, expect, it } from "vitest";

import { isBetsAuthPublicPath, isBetsProtectedPath } from "./bets-gate";

describe("bets path gate", () => {
  it("protects /bets and /api/bets only", () => {
    expect(isBetsProtectedPath("/bets")).toBe(true);
    expect(isBetsProtectedPath("/bets/")).toBe(true);
    expect(isBetsProtectedPath("/api/bets/export")).toBe(true);
    expect(isBetsProtectedPath("/")).toBe(false);
    expect(isBetsProtectedPath("/ai")).toBe(false);
    expect(isBetsProtectedPath("/login")).toBe(false);
    expect(isBetsProtectedPath("/api/auth/signin")).toBe(false);
    expect(isBetsProtectedPath("/api/health")).toBe(false);
  });

  it("keeps login and Auth.js public", () => {
    expect(isBetsAuthPublicPath("/login")).toBe(true);
    expect(isBetsAuthPublicPath("/api/auth/callback/google")).toBe(true);
  });
});
