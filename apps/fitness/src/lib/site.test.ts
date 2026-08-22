import { describe, expect, it } from "vitest";

import { getFitnessSiteConfig } from "./site";

describe("getFitnessSiteConfig", () => {
  it("defaults to the production community and fantasy hosts", () => {
    const config = getFitnessSiteConfig();
    expect(config.communitySiteUrl).toBe("https://strictlyjayers.com");
    expect(config.fantasyHubUrl).toBe("https://fantasy.strictlyjayers.com");
    expect(config.siteUrl).toMatch(/^https?:\/\//);
  });
});
