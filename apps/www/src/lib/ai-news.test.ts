import { describe, expect, it } from "vitest";

import { AI_EDITOR_PICKS, AI_TIMELINE_ACCOUNTS } from "./ai-news";
import { isXHandle, xProfileUrl } from "./people";

describe("AI_EDITOR_PICKS", () => {
  it("is a dated desk wall, not homepage dumps", () => {
    expect(AI_EDITOR_PICKS.length).toBeGreaterThanOrEqual(3);
    for (const pick of AI_EDITOR_PICKS) {
      expect(pick.title.trim().length).toBeGreaterThan(8);
      expect(pick.url).toMatch(/^https:\/\//);
      expect(pick.source.trim().length).toBeGreaterThan(2);
      expect(pick.blurb.trim().length).toBeGreaterThan(20);
      expect(pick.date.trim().length).toBeGreaterThan(4);
      // Homepages / section indexes feel like a feed dump.
      expect(pick.url).not.toMatch(/\/news\/?$/);
      expect(pick.url).not.toMatch(/\/blog\/?$/);
    }
  });
});

describe("AI_TIMELINE_ACCOUNTS", () => {
  it("ships official handles as link-out cards, not widgets", () => {
    expect(AI_TIMELINE_ACCOUNTS.map((a) => a.id)).toEqual([
      "openai",
      "anthropic",
      "cursor",
    ]);
    for (const account of AI_TIMELINE_ACCOUNTS) {
      expect(isXHandle(account.handle)).toBe(true);
      expect(xProfileUrl(account.handle)).toBe(`https://x.com/${account.handle}`);
      expect(account.blurb.trim().length).toBeGreaterThan(12);
    }
  });
});
