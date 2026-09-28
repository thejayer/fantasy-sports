import { describe, expect, it } from "vitest";

import { DEFAULT_DISCORD_INVITE_URL, getFitnessSiteConfig } from "./site";

describe("getFitnessSiteConfig", () => {
  it("defaults to the production community, fantasy, and Discord hosts", () => {
    const config = getFitnessSiteConfig();
    expect(config.communitySiteUrl).toBe("https://strictlyjayers.com");
    expect(config.fantasyHubUrl).toBe("https://fantasy.strictlyjayers.com");
    expect(config.discordInviteUrl).toBe(DEFAULT_DISCORD_INVITE_URL);
    expect(config.siteUrl).toMatch(/^https?:\/\//);
  });
});
