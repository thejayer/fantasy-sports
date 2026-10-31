import { describe, expect, it, vi } from "vitest";

import {
  CHAIN_TTL_MS,
  chainStep,
  hopUrl,
  nextHop,
  runHop,
  signChain,
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
