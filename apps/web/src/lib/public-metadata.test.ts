import { describe, expect, it } from "vitest";

import { isPublicMetadataPath } from "./public-metadata";

describe("isPublicMetadataPath", () => {
  it("allows Next metadata image routes", () => {
    expect(isPublicMetadataPath("/opengraph-image")).toBe(true);
    expect(isPublicMetadataPath("/opengraph-image/abc")).toBe(true);
    expect(isPublicMetadataPath("/twitter-image")).toBe(true);
    expect(isPublicMetadataPath("/icon")).toBe(true);
    expect(isPublicMetadataPath("/apple-icon")).toBe(true);
    expect(isPublicMetadataPath("/favicon.ico")).toBe(true);
  });

  it("does not open member routes", () => {
    expect(isPublicMetadataPath("/")).toBe(false);
    expect(isPublicMetadataPath("/leagues")).toBe(false);
    expect(isPublicMetadataPath("/login")).toBe(false);
    expect(isPublicMetadataPath("/icons")).toBe(false);
  });
});
