import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

import { GET } from "./route";

beforeEach(() => {
  authMock.mockReset();
  delete process.env.AUTH_DEV_BYPASS;
  process.env.FANTASY_HUB_URL = "https://hub.example.test";
  process.env.CASINO_URL = "https://casino.example.test";
});
afterEach(() => {
  delete process.env.AUTH_DEV_BYPASS;
  delete process.env.FANTASY_HUB_URL;
  delete process.env.CASINO_URL;
});

describe("GET /api/me", () => {
  it("returns the menu for a signed-in member, with no email or id", async () => {
    authMock.mockResolvedValue({
      user: { name: "Pat Jay", email: "pat@example.test", image: "https://img.example/p.png", id: "u-1" },
    });
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text).not.toContain("pat@example.test");
    expect(text).not.toContain("u-1");
    const body = JSON.parse(text);
    expect(body.signedIn).toBe(true);
    expect(body.user).toEqual({ name: "Pat Jay", image: "https://img.example/p.png" });
    expect(body.items.map((i: { label: string }) => i.label)).toEqual(["Profile", "Link teams", "Settings"]);
    expect(body.signOut).toBe("/api/signout-all");
  });

  it("falls back to the email local-part for the name, never the full email", async () => {
    authMock.mockResolvedValue({ user: { email: "pat.jay@example.test" } });
    const body = await (await GET()).json();
    expect(body.user.name).toBe("pat.jay");
  });

  it("is signed-out without a session", async () => {
    authMock.mockResolvedValue(null);
    const body = await (await GET()).json();
    expect(body.signedIn).toBe(false);
    expect(body.user).toBeNull();
  });

  it("treats an unreadable session as signed-out instead of failing", async () => {
    authMock.mockRejectedValue(new Error("bad cookie"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).signedIn).toBe(false);
  });

  it("drops a non-https avatar", async () => {
    authMock.mockResolvedValue({ user: { name: "Pat", image: "http://x/y.png" } });
    expect((await (await GET()).json()).user.image).toBeNull();
  });

  it("answers under dev bypass without touching auth", async () => {
    process.env.AUTH_DEV_BYPASS = "1";
    const body = await (await GET()).json();
    expect(body.user.name).toBe("Dev member");
    expect(authMock).not.toHaveBeenCalled();
  });
});
