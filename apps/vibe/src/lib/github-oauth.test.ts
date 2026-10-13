import { describe, expect, it } from "vitest";

import { stateSecret } from "./github-oauth";

describe("GitHub OAuth state secret", () => {
  it("uses AUTH_SECRET when set", () => {
    expect(stateSecret({ AUTH_SECRET: "from-auth" })).toBe("from-auth");
  });

  it("falls back to a local string only outside production", () => {
    expect(stateSecret({ NODE_ENV: "development" })).toBe("dev-vibe");
  });

  it("fails closed in production when no secret is configured", () => {
    expect(() => stateSecret({ NODE_ENV: "production" })).toThrow(/AUTH_SECRET/);
  });
});
