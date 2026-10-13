import { afterEach, describe, expect, it } from "vitest";

import { getVibeSiteConfig } from "./site";

describe("getVibeSiteConfig", () => {
  afterEach(() => {
    delete process.env.SITE_URL;
    delete process.env.FITNESS_URL;
  });

  it("defaults to the production sibling hosts", () => {
    delete process.env.SITE_URL;
    const site = getVibeSiteConfig();
    expect(site.fantasyHubUrl).toBe("https://fantasy.strictlyjayers.com");
    expect(site.fitnessUrl).toBe("https://fitness.strictlyjayers.com");
  });

  it("trims trailing slashes", () => {
    process.env.SITE_URL = "https://vibe.strictlyjayers.com/";
    expect(getVibeSiteConfig().siteUrl).toBe("https://vibe.strictlyjayers.com");
  });
});
