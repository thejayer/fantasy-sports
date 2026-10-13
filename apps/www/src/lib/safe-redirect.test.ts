import { describe, expect, it } from "vitest";

import { DEFAULT_CALLBACK_URL, safeCallbackUrl } from "./safe-redirect";

describe("safeCallbackUrl", () => {
  it("defaults to /bets", () => {
    expect(DEFAULT_CALLBACK_URL).toBe("/bets");
    expect(safeCallbackUrl(null)).toBe("/bets");
  });

  it("keeps same-origin paths", () => {
    expect(safeCallbackUrl("/bets?window=nfl")).toBe("/bets?window=nfl");
  });

  it("rejects absolute and protocol-relative targets", () => {
    expect(safeCallbackUrl("https://evil.example/phish")).toBe("/bets");
    expect(safeCallbackUrl("//evil.example")).toBe("/bets");
    expect(safeCallbackUrl("/\\evil.example")).toBe("/bets");
  });

  it("strips tab/CR/LF before validating", () => {
    expect(safeCallbackUrl("/\t/evil.example")).toBe("/bets");
  });
});
