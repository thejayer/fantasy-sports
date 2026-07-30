import { describe, expect, it } from "vitest";

import { teamMonogram } from "@/components/TeamAvatar";

describe("teamMonogram (roadmap 7.3)", () => {
  it("uses first and last initials for multi-word names", () => {
    expect(teamMonogram("Shotgun Syndicate")).toBe("SS");
    expect(teamMonogram("Red Zone Rebels")).toBe("RR");
  });

  it("takes two letters from a single word", () => {
    expect(teamMonogram("Titans")).toBe("TI");
  });

  it("strips punctuation and emoji rather than rendering them", () => {
    expect(teamMonogram("The 🔥 Bandits")).toBe("TB");
    expect(teamMonogram("Turf-Titans")).toBe("TT");
  });

  it("falls back to a placeholder for an unusable name", () => {
    expect(teamMonogram("")).toBe("?");
    expect(teamMonogram("   ")).toBe("?");
    expect(teamMonogram("🔥")).toBe("?");
  });
});
