import { describe, expect, it } from "vitest";

import { DEFAULT_CALLBACK_URL, safeCallbackUrl } from "./safe-redirect";

describe("safeCallbackUrl", () => {
  it("keeps same-origin paths", () => {
    expect(safeCallbackUrl("/app.html")).toBe("/app.html");
    expect(safeCallbackUrl("/?tab=log")).toBe("/?tab=log");
  });

  it("rejects absolute and protocol-relative targets", () => {
    expect(safeCallbackUrl("https://evil.example/phish")).toBe(
      DEFAULT_CALLBACK_URL,
    );
    expect(safeCallbackUrl("//evil.example")).toBe(DEFAULT_CALLBACK_URL);
    expect(safeCallbackUrl("/\\evil.example")).toBe(DEFAULT_CALLBACK_URL);
  });

  it("strips tab/CR/LF before validating", () => {
    // "/\t/host" becomes "//host" after browsers strip the tab.
    expect(safeCallbackUrl("/\t/evil.example")).toBe(DEFAULT_CALLBACK_URL);
  });
});
