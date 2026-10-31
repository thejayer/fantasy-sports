import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signOut = vi.fn(async () => ({ redirect: "/" }));
vi.mock("@/auth", () => ({ signOut: (...args: unknown[]) => signOut(...(args as [])) }));

import { verifyChain } from "@/lib/signout-chain";

import { GET, POST } from "./route";

const SECRET = "test-secret-for-signout";
const SITES = {
  SITE_URL: "https://hub.example.test",
  COMMUNITY_SITE_URL: "https://www.example.test",
  FANTASY_HUB_URL: "https://hub.example.test",
  FITNESS_URL: "https://fit.example.test",
  VIBE_URL: "https://vibe.example.test",
};
const OWN = "https://hub.example.test";

function post(headers: Record<string, string>) {
  return POST(new Request(`${OWN}/api/auth/signout-all`, { method: "POST", headers }));
}

beforeEach(() => {
  signOut.mockClear();
  Object.assign(process.env, SITES);
  process.env.AUTH_SECRET = SECRET;
});
afterEach(() => {
  for (const k of Object.keys(SITES)) delete process.env[k];
  delete process.env.AUTH_SECRET;
});

describe("POST /api/auth/signout-all (hub)", () => {
  it("refuses a cross-site post and signs nobody out", async () => {
    const res = await post({ origin: "https://evil.test" });
    expect(res.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
    expect((await post({})).status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs out here, then hands off to www's hop with a signed token", async () => {
    const res = await post({ origin: OWN });
    expect(res.status).toBe(303);
    expect(signOut).toHaveBeenCalledWith({ redirect: false });
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.origin).toBe(SITES.COMMUNITY_SITE_URL);
    expect(loc.pathname).toBe("/api/auth/signout-chain");
    const rest = verifyChain(SECRET, loc.searchParams.get("t") ?? "", Date.now())?.rest;
    expect(rest).toBeDefined();
    expect(rest).not.toContain("hub");
    expect(rest).not.toContain("www");
  });

  it("only clears this site and lands on /login when no shared secret is configured", async () => {
    delete process.env.AUTH_SECRET;
    const res = await post({ origin: OWN });
    expect(res.status).toBe(303);
    expect(signOut).toHaveBeenCalledOnce();
    expect(res.headers.get("location")).toBe("/login");
  });

  it("does nothing on GET", () => {
    const res = GET();
    expect(res.status).toBe(405);
    expect(signOut).not.toHaveBeenCalled();
  });
});
