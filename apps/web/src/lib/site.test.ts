import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_DISCORD_INVITE_URL, getHubSiteConfig } from "./site";

describe("getHubSiteConfig", () => {
  const keys = [
    "AUTH_URL",
    "SITE_URL",
    "COMMUNITY_SITE_URL",
    "FITNESS_URL",
    "DISCORD_INVITE_URL",
  ] as const;
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of keys) {
      const value = prior[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("defaults to production community, fitness, and Discord hosts", () => {
    delete process.env.AUTH_URL;
    delete process.env.SITE_URL;
    delete process.env.COMMUNITY_SITE_URL;
    delete process.env.FITNESS_URL;
    delete process.env.DISCORD_INVITE_URL;
    const config = getHubSiteConfig();
    expect(config.communitySiteUrl).toBe("https://strictlyjayers.com");
    expect(config.fitnessUrl).toBe("https://fitness.strictlyjayers.com");
    expect(config.discordInviteUrl).toBe(DEFAULT_DISCORD_INVITE_URL);
    expect(config.siteUrl).toMatch(/^https?:\/\//);
  });

  it("honors env overrides without trailing slashes", () => {
    process.env.COMMUNITY_SITE_URL = "https://example.com/";
    process.env.FITNESS_URL = "https://fit.example.com/";
    process.env.DISCORD_INVITE_URL = "https://discord.gg/override/";
    const config = getHubSiteConfig();
    expect(config.communitySiteUrl).toBe("https://example.com");
    expect(config.fitnessUrl).toBe("https://fit.example.com");
    expect(config.discordInviteUrl).toBe("https://discord.gg/override");
  });
});
