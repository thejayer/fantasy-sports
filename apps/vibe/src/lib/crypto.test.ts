import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, parseTokenKey } from "./crypto";

const KEY = parseTokenKey(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
)!;

describe("token encryption", () => {
  it("round-trips a GitHub PAT", () => {
    const enc = encryptSecret("github_pat_secret", KEY);
    expect(enc).not.toContain("github_pat_secret");
    expect(decryptSecret(enc, KEY)).toBe("github_pat_secret");
  });

  it("rejects a tampered payload", () => {
    const enc = encryptSecret("github_pat_secret", KEY);
    const [iv, data, tag] = enc.split(".");
    const flipped = tag && tag[0] === "A" ? "B" : "A";
    expect(() => decryptSecret(`${iv}.${data}.${flipped}${tag?.slice(1)}`, KEY)).toThrow();
  });
});
