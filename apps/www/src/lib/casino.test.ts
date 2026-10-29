import { afterEach, describe, expect, it } from "vitest";

import {
  casinoRewrites,
  casinoUpstream,
  isCasinoConfigured,
  isCasinoPath,
} from "./casino";

afterEach(() => {
  delete process.env.CASINO_URL;
});

describe("casinoUpstream", () => {
  it("is off when unset, blank, or not an http(s) URL", () => {
    expect(casinoUpstream(undefined)).toBeNull();
    expect(casinoUpstream("")).toBeNull();
    expect(casinoUpstream("   ")).toBeNull();
    expect(casinoUpstream("not-a-url")).toBeNull();
    expect(casinoUpstream("ftp://example.com")).toBeNull();
  });

  it("trims a trailing slash and keeps a local http origin", () => {
    expect(casinoUpstream("https://casino.example/")).toBe(
      "https://casino.example",
    );
    expect(casinoUpstream("http://127.0.0.1:9")).toBe("http://127.0.0.1:9");
  });
});

describe("casinoRewrites", () => {
  it("returns no rules when the feature is off", () => {
    delete process.env.CASINO_URL;
    expect(casinoRewrites()).toEqual([]);
    expect(isCasinoConfigured()).toBe(false);
  });

  it("rewrites /casino and /casino/* onto the upstream (not a redirect)", () => {
    const rules = casinoRewrites("https://casino.example");
    expect(rules).toEqual([
      { source: "/casino", destination: "https://casino.example/casino" },
      {
        source: "/casino/:path*",
        destination: "https://casino.example/casino/:path*",
      },
    ]);
  });
});

describe("isCasinoPath", () => {
  it("matches /casino and nested paths only", () => {
    expect(isCasinoPath("/casino")).toBe(true);
    expect(isCasinoPath("/casino/")).toBe(true);
    expect(isCasinoPath("/casino/table.png")).toBe(true);
    expect(isCasinoPath("/bets")).toBe(false);
    expect(isCasinoPath("/casino-night")).toBe(false);
  });
});
