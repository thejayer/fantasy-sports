import { describe, expect, it } from "vitest";

import { AI_EDITOR_PICKS } from "./ai-news";

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
