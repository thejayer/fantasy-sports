import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signOut = vi.fn(async () => ({ redirect: "/" }));
vi.mock("@/auth", () => ({ signOut: (...args: unknown[]) => signOut(...(args as [])) }));

import { verifyChain } from "@/lib/signout-chain";

import { GET, POST } from "./route";

const SECRET = "test-secret-for-signout";
const ENV = {
  SITE_URL: "https://www.example.test",
  FANTASY_HUB_URL: "https://hub.example.test",
  FITNESS_URL: "https://fit.example.test",
  VIBE_URL: "https://vibe.example.test",
};

function post(headers: Record<string, string>) {
  return POST(new Request("https://www.example.test/api/signout-all", { method: "POST", headers }));
}

beforeEach(() => {
  signOut.mockClear();
  Object.assign(process.env, ENV);
  process.env.AUTH_SECRET = SECRET;
});
afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  delete process.env.AUTH_SECRET;
});

describe("POST /api/signout-all", () => {
  it("refuses a cross-site post and signs nobody out", async () => {
    const res = await post({ origin: "https://evil.test" });
    expect(res.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("refuses a post with no origin signal", async () => {
    expect((await post({})).status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs out here, then hands off to the hub's hop with a signed token", async () => {
    const res = await post({ origin: ENV.SITE_URL });
    expect(res.status).toBe(303);
    expect(signOut).toHaveBeenCalledWith({ redirect: false });
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.origin).toBe(ENV.FANTASY_HUB_URL);
    expect(loc.pathname).toBe("/api/auth/signout-chain");
    const claims = verifyChain(SECRET, loc.searchParams.get("t") ?? "", Date.now());
    expect(claims?.rest).toEqual(["fitness", "vibe"]);
  });

  it("only clears this site when no shared secret is configured", async () => {
    delete process.env.AUTH_SECRET;
    const res = await post({ origin: ENV.SITE_URL });
    expect(res.status).toBe(303);
    expect(signOut).toHaveBeenCalledOnce();
    expect(res.headers.get("location")).toBe("/signed-out");
  });

  it("does nothing on GET", async () => {
    const res = GET();
    expect(res.status).toBe(405);
    expect(signOut).not.toHaveBeenCalled();
  });
});
