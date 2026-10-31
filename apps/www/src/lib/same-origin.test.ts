import { describe, expect, it } from "vitest";

import { isSameOriginRequest } from "./same-origin";

const SITE = "https://www.example.test";
const req = (headers: Record<string, string>) =>
  new Request("https://www.example.test/api/signout-all", { method: "POST", headers });

describe("isSameOriginRequest", () => {
  it("accepts this site's own origin", () => {
    expect(isSameOriginRequest(req({ origin: SITE }), SITE)).toBe(true);
  });
  it("accepts the request's own origin when the configured URL differs", () => {
    expect(isSameOriginRequest(req({ origin: "https://www.example.test" }), "https://other.test")).toBe(true);
  });
  it("rejects a foreign origin", () => {
    expect(isSameOriginRequest(req({ origin: "https://evil.test" }), SITE)).toBe(false);
    expect(isSameOriginRequest(req({ origin: "null" }), SITE)).toBe(false);
    expect(isSameOriginRequest(req({ origin: "https://www.example.test.evil.test" }), SITE)).toBe(false);
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
