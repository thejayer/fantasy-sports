import { afterEach, describe, expect, it } from "vitest";

import {
  isBetsAuthPublicPath,
  isBetsProtectedPath,
  isMembersProtectedPath,
  isProfilePath,
  membersLoginTitle,
} from "./bets-gate";

afterEach(() => {
  delete process.env.CASINO_URL;
});

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
    expect(isBetsProtectedPath("/casino")).toBe(false);
  });

  it("keeps login and Auth.js public", () => {
    expect(isBetsAuthPublicPath("/login")).toBe(true);
    expect(isBetsAuthPublicPath("/api/auth/callback/google")).toBe(true);
  });
});

describe("members path gate", () => {
  it("always includes /bets and never /casino when the proxy is off", () => {
    delete process.env.CASINO_URL;
    expect(isMembersProtectedPath("/bets")).toBe(true);
    expect(isMembersProtectedPath("/api/bets/export")).toBe(true);
    expect(isMembersProtectedPath("/casino")).toBe(false);
    expect(isMembersProtectedPath("/casino/table.png")).toBe(false);
    expect(isMembersProtectedPath("/")).toBe(false);
  });

  it("always protects /profile, with or without the casino", () => {
    delete process.env.CASINO_URL;
    expect(isProfilePath("/profile")).toBe(true);
    expect(isMembersProtectedPath("/profile")).toBe(true);
    expect(isMembersProtectedPath("/profile/")).toBe(true);
    expect(isMembersProtectedPath("/profile/anything")).toBe(true);
    process.env.CASINO_URL = "https://casino.example";
    expect(isMembersProtectedPath("/profile")).toBe(true);
    // Look-alikes stay public.
    expect(isProfilePath("/profiles")).toBe(false);
    expect(isProfilePath("/people")).toBe(false);
    expect(isMembersProtectedPath("/signed-out")).toBe(false);
    expect(isMembersProtectedPath("/api/me")).toBe(false);
    expect(isMembersProtectedPath("/api/signout-all")).toBe(false);
  });

  it("adds /casino when CASINO_URL is set", () => {
    process.env.CASINO_URL = "https://casino.example";
    expect(isMembersProtectedPath("/casino")).toBe(true);
    expect(isMembersProtectedPath("/casino/")).toBe(true);
    expect(isMembersProtectedPath("/casino/app")).toBe(true);
    expect(isMembersProtectedPath("/bets")).toBe(true);
    expect(isMembersProtectedPath("/ai")).toBe(false);
    expect(isBetsProtectedPath("/casino")).toBe(false);
  });

  it("titles the login page from the callback path", () => {
    expect(membersLoginTitle("/bets")).toBe("Sign in to Bets");
    expect(membersLoginTitle("/bets?tab=options")).toBe("Sign in to Bets");
    expect(membersLoginTitle("/casino")).toBe("Sign in to Casino");
    expect(membersLoginTitle("/casino/app")).toBe("Sign in to Casino");
    expect(membersLoginTitle("/profile")).toBe("Sign in to your profile");
    expect(membersLoginTitle("/profile#linked-teams")).toBe("Sign in to your profile");
  });
});
