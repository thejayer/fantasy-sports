import { afterEach, describe, expect, it } from "vitest";

import {
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

describe("isCasinoConfigured", () => {
  it("follows CASINO_URL at call time", () => {
    delete process.env.CASINO_URL;
    expect(isCasinoConfigured()).toBe(false);
    process.env.CASINO_URL = "https://casino.example";
    expect(isCasinoConfigured()).toBe(true);
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
