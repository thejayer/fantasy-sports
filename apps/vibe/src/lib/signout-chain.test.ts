import { describe, expect, it, vi } from "vitest";

import {
  CHAIN_TTL_MS,
  chainStep,
  hopUrl,
  isSameOriginRequest,
  nextHop,
  runHop,
  signChain,
  sitesAfter,
  startChain,
  verifyChain,
  type SiteKey,
  type SiteUrls,
} from "@/lib/signout-chain";

const SECRET = "test-secret-one";
const NOW = 1_800_000_000_000;
const urls: SiteUrls = {
  www: "https://www.example.test",
  hub: "https://hub.example.test/",
  fitness: "https://fit.example.test",
  vibe: "https://vibe.example.test",
};

function tokenOf(location: string): string {
  return new URL(location).searchParams.get("t") ?? "";
}

describe("sign-out chain token", () => {
  it("round-trips the remaining sites", () => {
    const t = signChain(SECRET, ["hub", "vibe"], NOW);
    expect(verifyChain(SECRET, t, NOW + 1000)).toEqual({ rest: ["hub", "vibe"] });
  });

  it("expires", () => {
    const t = signChain(SECRET, ["hub"], NOW);
    expect(verifyChain(SECRET, t, NOW + CHAIN_TTL_MS - 1)).not.toBeNull();
    expect(verifyChain(SECRET, t, NOW + CHAIN_TTL_MS + 1)).toBeNull();
  });

  it("rejects another secret, a tampered body and junk", () => {
    const t = signChain(SECRET, ["hub"], NOW);
    expect(verifyChain("other-secret", t, NOW)).toBeNull();
    const [body, sig] = t.split(".") as [string, string];
    const forged = Buffer.from(
      JSON.stringify({ v: 1, exp: NOW + 10 ** 9, n: "x", rest: ["hub", "vibe", "fitness"] }),
    ).toString("base64url");
    expect(verifyChain(SECRET, `${forged}.${sig}`, NOW)).toBeNull();
    expect(verifyChain(SECRET, `${body}.AAAA`, NOW)).toBeNull();
    expect(verifyChain(SECRET, "", NOW)).toBeNull();
    expect(verifyChain(SECRET, null, NOW)).toBeNull();
    expect(verifyChain(SECRET, "a.b.c", NOW)).toBeNull();
    expect(verifyChain(SECRET, "x".repeat(2000), NOW)).toBeNull();
    expect(verifyChain("", t, NOW)).toBeNull();
  });

  it("never accepts a hand-built payload signed with the bare secret", async () => {
    const { createHmac } = await import("node:crypto");
    const body = Buffer.from(
      JSON.stringify({ v: 1, exp: NOW + 5000, n: "x", rest: ["hub"] }),
    ).toString("base64url");
    const bare = createHmac("sha256", SECRET).update(body).digest("base64url");
    expect(verifyChain(SECRET, `${body}.${bare}`, NOW)).toBeNull();
  });

  it("drops site keys it does not know", () => {
    const t = signChain(SECRET, ["hub", "evil.example" as SiteKey, "vibe"], NOW);
    expect(verifyChain(SECRET, t, NOW)).toEqual({ rest: ["hub", "vibe"] });
  });

  it("two tokens for the same chain differ", () => {
    expect(signChain(SECRET, ["hub"], NOW)).not.toBe(signChain(SECRET, ["hub"], NOW));
  });
});

describe("hop planning", () => {
  it("skips sites with no configured URL and keeps what follows", () => {
    expect(nextHop({ vibe: "https://v.example.test" }, ["hub", "fitness", "vibe"])).toEqual({
      origin: "https://v.example.test",
      after: [],
    });
  });

  it("takes the origin only, and refuses non-http URLs", () => {
    expect(nextHop({ hub: "https://h.example.test/some/path?x=1" }, ["hub"])?.origin).toBe(
      "https://h.example.test",
    );
    expect(nextHop({ hub: "javascript:alert(1)", fitness: "ftp://x.test" }, ["hub", "fitness"])).toBeNull();
    expect(nextHop({ hub: "not a url" }, ["hub"])).toBeNull();
  });

  it("builds the hop URL on the site's own path", () => {
    expect(hopUrl("https://h.example.test", "a.b")).toBe("https://h.example.test/api/auth/signout-chain?t=a.b");
  });

  it("lands on the www signed-out page when nothing is left, or says so when www is unknown", () => {
    const done = chainStep(urls, SECRET, [], NOW);
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe("https://www.example.test/signed-out");
    expect(chainStep({}, SECRET, [], NOW).status).toBe(200);
  });
});

describe("runHop", () => {
  it("signs out, then redirects to the next configured site with a token for the rest", async () => {
    const signOutLocal = vi.fn(async () => undefined);
    const token = signChain(SECRET, ["fitness", "vibe"], NOW);
    const res = await runHop(token, { secret: SECRET, urls, signOutLocal, now: NOW + 5 });
    expect(signOutLocal).toHaveBeenCalledOnce();
    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("https://fit.example.test/api/auth/signout-chain?t=")).toBe(true);
    expect(verifyChain(SECRET, tokenOf(location), NOW + 5)).toEqual({ rest: ["vibe"] });
  });

  it("only ever redirects to a configured Strictly Jayers host", async () => {
    const allowed = new Set(["https://www.example.test", "https://hub.example.test", "https://fit.example.test", "https://vibe.example.test"]);
    const rests: SiteKey[][] = [[], ["hub"], ["vibe", "hub"], ["evil.example" as SiteKey, "hub"]];
    for (const rest of rests) {
      const res = await runHop(signChain(SECRET, rest, NOW), {
        secret: SECRET,
        urls,
        signOutLocal: async () => undefined,
        now: NOW,
      });
      expect(allowed.has(new URL(res.headers.get("location") ?? "").origin)).toBe(true);
    }
  });

  it("does nothing for a missing, forged or expired token", async () => {
    const signOutLocal = vi.fn(async () => undefined);
    for (const token of [null, "", "nope", signChain("other", ["hub"], NOW), signChain(SECRET, ["hub"], NOW - CHAIN_TTL_MS * 2)]) {
      const res = await runHop(token, { secret: SECRET, urls, signOutLocal, now: NOW });
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
    }
    expect(signOutLocal).not.toHaveBeenCalled();
  });

  it("fails closed when the site has no secret", async () => {
    const signOutLocal = vi.fn(async () => undefined);
    const res = await runHop(signChain(SECRET, [], NOW), { secret: undefined, urls, signOutLocal, now: NOW });
    expect(res.status).toBe(400);
    expect(signOutLocal).not.toHaveBeenCalled();
  });
});

describe("sitesAfter", () => {
  it("puts www first, then the rest in a fixed order, never the starting site", () => {
    expect(sitesAfter("www")).toEqual(["hub", "fitness", "vibe"]);
    expect(sitesAfter("hub")).toEqual(["www", "fitness", "vibe"]);
    expect(sitesAfter("fitness")).toEqual(["www", "hub", "vibe"]);
    expect(sitesAfter("vibe")).toEqual(["www", "hub", "fitness"]);
  });
});

describe("isSameOriginRequest", () => {
  const SITE = "https://hub.example.test";
  const req = (headers: Record<string, string>) =>
    new Request("https://hub.example.test/api/auth/signout-all", { method: "POST", headers });

  it("accepts this site's own origin", () => {
    expect(isSameOriginRequest(req({ origin: SITE }), SITE)).toBe(true);
  });
  it("accepts the request's own origin when the configured URL differs", () => {
    expect(isSameOriginRequest(req({ origin: "https://hub.example.test" }), "https://other.test")).toBe(true);
  });
  it("rejects a foreign origin", () => {
    expect(isSameOriginRequest(req({ origin: "https://evil.test" }), SITE)).toBe(false);
    expect(isSameOriginRequest(req({ origin: "null" }), SITE)).toBe(false);
    expect(isSameOriginRequest(req({ origin: "https://hub.example.test.evil.test" }), SITE)).toBe(false);
    // another Strictly Jayers site is still a different origin
    expect(isSameOriginRequest(req({ origin: "https://www.example.test" }), SITE)).toBe(false);
  });
  it("falls back to Sec-Fetch-Site without an Origin", () => {
    expect(isSameOriginRequest(req({ "sec-fetch-site": "same-origin" }), SITE)).toBe(true);
    expect(isSameOriginRequest(req({ "sec-fetch-site": "cross-site" }), SITE)).toBe(false);
    expect(isSameOriginRequest(req({ "sec-fetch-site": "same-site" }), SITE)).toBe(false);
  });
  it("rejects when the browser says nothing", () => {
    expect(isSameOriginRequest(req({}), SITE)).toBe(false);
  });
});

describe("startChain", () => {
  const post = (headers: Record<string, string>) =>
    new Request("https://hub.example.test/api/auth/signout-all", { method: "POST", headers });
  const base = (signOutLocal: () => Promise<unknown>) => ({
    self: "hub" as SiteKey,
    secret: SECRET as string | undefined,
    urls,
    signOutLocal,
    localLanding: "/login",
    now: NOW,
  });

  it("refuses a cross-site start and signs nobody out", async () => {
    const signOutLocal = vi.fn(async () => undefined);
    const res = await startChain(post({ origin: "https://evil.test" }), base(signOutLocal));
    expect(res.status).toBe(403);
    expect(signOutLocal).not.toHaveBeenCalled();
    expect((await startChain(post({}), base(signOutLocal))).status).toBe(403);
    expect(signOutLocal).not.toHaveBeenCalled();
  });

  it("signs this site out first, then hops to www with the rest signed in the token", async () => {
    const order: string[] = [];
    const res = await startChain(
      post({ origin: "https://hub.example.test" }),
      base(async () => {
        order.push("local");
      }),
    );
    order.push("redirect");
    expect(order).toEqual(["local", "redirect"]);
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.origin).toBe("https://www.example.test");
    expect(loc.pathname).toBe("/api/auth/signout-chain");
    expect(verifyChain(SECRET, tokenOf(loc.href), NOW)?.rest).toEqual(["fitness", "vibe"]);
  });

  it("walks the whole chain from vibe and ends on the www landing page", async () => {
    let location = (
      await startChain(post({ origin: "https://vibe.example.test" }), {
        ...base(async () => undefined),
        self: "vibe",
      })
    ).headers.get("location");
    const visited: string[] = [];
    for (let i = 0; i < 6 && location && !location.endsWith("/signed-out"); i += 1) {
      visited.push(new URL(location).origin);
      const res = await runHop(tokenOf(location), { secret: SECRET, urls, signOutLocal: async () => undefined, now: NOW });
      location = res.headers.get("location");
    }
    expect(visited).toEqual(["https://www.example.test", "https://hub.example.test", "https://fit.example.test"]);
    expect(location).toBe("https://www.example.test/signed-out");
  });

  it("without a shared secret it only signs this site out and lands where a plain sign out did", async () => {
    const signOutLocal = vi.fn(async () => undefined);
    const res = await startChain(post({ origin: "https://hub.example.test" }), { ...base(signOutLocal), secret: undefined });
    expect(signOutLocal).toHaveBeenCalledOnce();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("falls back to the local landing page when no other site is configured", async () => {
    const res = await startChain(post({ origin: "https://hub.example.test" }), {
      ...base(async () => undefined),
      urls: { hub: "https://hub.example.test" },
    });
    expect(res.headers.get("location")).toBe("/login");
  });

  it("a hop that fails later never un-signs this site: the local sign out already ran", async () => {
    const signOutLocal = vi.fn(async () => undefined);
    const res = await startChain(post({ origin: "https://hub.example.test" }), base(signOutLocal));
    const t = tokenOf(res.headers.get("location") ?? "");
    const bad = await runHop(`${t}x`, { secret: SECRET, urls, signOutLocal: vi.fn(async () => undefined), now: NOW });
    expect(bad.status).toBe(400);
    expect(signOutLocal).toHaveBeenCalledOnce();
  });
});
