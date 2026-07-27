import { describe, expect, it } from "vitest";

import { DEFAULT_CALLBACK_URL, safeCallbackUrl } from "@/lib/safe-redirect";

describe("safeCallbackUrl", () => {
  it("keeps same-origin paths", () => {
    expect(safeCallbackUrl("/")).toBe("/");
    expect(safeCallbackUrl("/leagues")).toBe("/leagues");
    expect(safeCallbackUrl("/leagues/football-main")).toBe("/leagues/football-main");
  });

  it("preserves query strings and fragments", () => {
    expect(safeCallbackUrl("/leagues/football-main?tab=players")).toBe(
      "/leagues/football-main?tab=players",
    );
    expect(safeCallbackUrl("/leagues/x?season=2015&tab=teams")).toBe(
      "/leagues/x?season=2015&tab=teams",
    );
    expect(safeCallbackUrl("/leagues#standings")).toBe("/leagues#standings");
  });

  // The exact payloads that were reproduced against the running app.
  it.each([
    "https://example.com/",
    "http://example.com/",
    "//example.com",
    "//example.com/leagues",
  ])("rejects off-origin target %s", (payload) => {
    expect(safeCallbackUrl(payload)).toBe(DEFAULT_CALLBACK_URL);
  });

  it("rejects backslash authorities the URL parser normalises", () => {
    // "/\evil.com" resolves to an authority, not a path.
    expect(safeCallbackUrl("/\\evil.com")).toBe(DEFAULT_CALLBACK_URL);
    expect(safeCallbackUrl("/\\\\evil.com")).toBe(DEFAULT_CALLBACK_URL);
    expect(safeCallbackUrl("\\\\evil.com")).toBe(DEFAULT_CALLBACK_URL);
  });

  it("rejects targets that only become off-origin after browser stripping", () => {
    // Browsers strip tabs and newlines, turning these into "//evil.com".
    expect(safeCallbackUrl("/\t/evil.com")).toBe(DEFAULT_CALLBACK_URL);
    expect(safeCallbackUrl("/\n/evil.com")).toBe(DEFAULT_CALLBACK_URL);
    expect(safeCallbackUrl("/\r/evil.com")).toBe(DEFAULT_CALLBACK_URL);
    expect(safeCallbackUrl("/\t\t/evil.com")).toBe(DEFAULT_CALLBACK_URL);
  });

  it("rejects non-http schemes", () => {
    expect(safeCallbackUrl("javascript:alert(1)")).toBe(DEFAULT_CALLBACK_URL);
    expect(safeCallbackUrl("data:text/html,<script>alert(1)</script>")).toBe(
      DEFAULT_CALLBACK_URL,
    );
    expect(safeCallbackUrl("mailto:someone@example.com")).toBe(DEFAULT_CALLBACK_URL);
  });

  it("rejects anything that is not a rooted path", () => {
    expect(safeCallbackUrl("leagues")).toBe(DEFAULT_CALLBACK_URL);
    expect(safeCallbackUrl("../leagues")).toBe(DEFAULT_CALLBACK_URL);
    expect(safeCallbackUrl("")).toBe(DEFAULT_CALLBACK_URL);
    expect(safeCallbackUrl(null)).toBe(DEFAULT_CALLBACK_URL);
    expect(safeCallbackUrl(undefined)).toBe(DEFAULT_CALLBACK_URL);
  });

  it("rejects embedded control characters and whitespace", () => {
    expect(safeCallbackUrl("/leagues\u0000")).toBe(DEFAULT_CALLBACK_URL);
    expect(safeCallbackUrl("/leagues with space")).toBe(DEFAULT_CALLBACK_URL);
  });

  it("treats percent-encoded slashes as path content, not an authority", () => {
    // "/%2F%2Fevil.com" is a real same-origin path; browsers do not decode it
    // into an authority, so it is safe to keep.
    expect(safeCallbackUrl("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
  });

  it("honours a custom fallback", () => {
    expect(safeCallbackUrl("https://example.com", "/leagues")).toBe("/leagues");
  });

  it("never returns a value that resolves off-origin", () => {
    const origin = "https://hub.example";
    const payloads = [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "javascript:alert(1)",
      "/leagues",
      "/",
    ];
    for (const payload of payloads) {
      const resolved = new URL(safeCallbackUrl(payload), origin);
      expect(resolved.origin).toBe(origin);
    }
  });
});
