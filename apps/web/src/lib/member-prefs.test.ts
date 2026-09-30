import { describe, expect, it } from "vitest";

import type { HockeyBio } from "@/lib/hockey-nhl";
import {
  NOTE_MAX,
  emptyPrefs,
  isKept,
  isWatched,
  sanitizePref,
  taggedBio,
  taggedBios,
  upsertPref,
} from "@/lib/member-prefs";

const bio = {
  nhlId: 8,
  role: "Line 3",
  pp: "No PP",
  roleBasis: "Daily Faceoff",
} as unknown as HockeyBio;

describe("sanitizePref", () => {
  it("keeps known tags, one PP and one line tag (last wins)", () => {
    const pref = sanitizePref({ tags: ["PP1", "Keep", "Bogus", "PP2", "Top 6", "Bottom 6", "Watch", "Keep"], note: " hi " });
    expect(pref).toEqual({ tags: ["PP2", "Bottom 6", "Watch", "Keep"], note: "hi" });
  });

  it("caps the note and drops an empty pref", () => {
    expect(sanitizePref({ tags: [], note: "x".repeat(NOTE_MAX + 50) })!.note).toHaveLength(NOTE_MAX);
    expect(sanitizePref({ tags: ["nope"], note: "   " })).toBeNull();
    expect(sanitizePref({ tags: "Keep" as unknown, note: 5 as unknown })).toBeNull();
  });
});

describe("tags", () => {
  it("reads Keep and Watch", () => {
    expect(isKept({ tags: ["Keep"], note: "" })).toBe(true);
    expect(isWatched({ tags: ["Watch"], note: "" })).toBe(true);
    expect(isKept(undefined)).toBe(false);
  });

  it("overrides the automatic role and PP for the member only", () => {
    const next = taggedBio(bio, { tags: ["PP1", "Top 6"], note: "" })!;
    expect(next.pp).toBe("PP1");
    expect(next.role).toBe("Top 6");
    expect(next.roleBasis).toBe("Your tag");
    expect(bio.pp).toBe("No PP"); // the shared bio is untouched
    expect(taggedBio(bio, { tags: ["Watch"], note: "" })).toBe(bio);
    expect(taggedBio(undefined, { tags: ["PP1"], note: "" })).toBeUndefined();
  });

  it("applies to a whole bio index", () => {
    const prefs = upsertPref(emptyPrefs("hockey-main"), "1", { tags: ["Starting goalie"], note: "" });
    const out = taggedBios({ "1": bio, "2": bio }, prefs);
    expect(out["1"]!.role).toBe("Starting G");
    expect(out["2"]).toBe(bio);
    expect(taggedBios({ "1": bio }, null)["1"]).toBe(bio);
  });

  it("upserts and removes a player", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const one = upsertPref(emptyPrefs("hockey-main"), "5", { tags: ["Keep"], note: "" }, now);
    expect(one.players["5"]!.tags).toEqual(["Keep"]);
    expect(one.updated_at).toBe(now.toISOString());
    expect(upsertPref(one, "5", null).players).toEqual({});
  });
});
