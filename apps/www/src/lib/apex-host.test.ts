import { describe, expect, it } from "vitest";

import {
  apexRedirectUrl,
  preferredHostFromSiteUrl,
  shouldRedirectWwwToApex,
} from "./apex-host";

describe("preferredHostFromSiteUrl", () => {
  it("extracts production apex", () => {
    expect(preferredHostFromSiteUrl("https://strictlyjayers.com")).toBe(
      "strictlyjayers.com",
    );
  });

  it("ignores local and run.app URLs", () => {
    expect(preferredHostFromSiteUrl("http://localhost:3002")).toBeNull();
    expect(
      preferredHostFromSiteUrl("https://sj-www-w6arul2i6a-uc.a.run.app"),
    ).toBeNull();
  });
});

describe("shouldRedirectWwwToApex", () => {
  const site = "https://strictlyjayers.com";

  it("redirects www only", () => {
    expect(shouldRedirectWwwToApex("www.strictlyjayers.com", site)).toBe(true);
    expect(shouldRedirectWwwToApex("strictlyjayers.com", site)).toBe(false);
    expect(shouldRedirectWwwToApex("sj-www-x.a.run.app", site)).toBe(false);
  });
});

describe("apexRedirectUrl", () => {
  it("preserves path and query", () => {
    expect(apexRedirectUrl("https://strictlyjayers.com/", "/watch", "?x=1")).toBe(
      "https://strictlyjayers.com/watch?x=1",
    );
  });
});
