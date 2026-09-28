import { describe, expect, it } from "vitest";

import {
  INFLUENTIAL_PEOPLE,
  PEOPLE_LANES,
  isXHandle,
  peopleByLane,
  personInitials,
  xProfileUrl,
} from "./people";

describe("influential people directory", () => {
  it("keeps unique X handles and groups every lane", () => {
    const handles = INFLUENTIAL_PEOPLE.map((p) => p.handle.toLowerCase());
    expect(new Set(handles).size).toBe(handles.length);
    expect(INFLUENTIAL_PEOPLE.length).toBeGreaterThanOrEqual(8);
    for (const person of INFLUENTIAL_PEOPLE) {
      expect(isXHandle(person.handle)).toBe(true);
      expect(xProfileUrl(person.handle)).toBe(`https://x.com/${person.handle}`);
      expect(person.name.trim().length).toBeGreaterThan(2);
      expect(person.bio.trim().length).toBeGreaterThan(80);
      expect(person.bio.split(/(?<=[.!?])\s+/).length).toBeGreaterThanOrEqual(2);
      if (person.photo) {
        expect(person.photo).toMatch(/^\/people\/[a-z0-9-]+\.jpg$/);
        expect(person.photoCredit?.length).toBeGreaterThan(8);
      }
    }
    const grouped = peopleByLane();
    expect(grouped.map((g) => g.lane)).toEqual([...PEOPLE_LANES]);
    expect(grouped.flatMap((g) => g.people)).toHaveLength(
      INFLUENTIAL_PEOPLE.length,
    );
  });

  it("includes Elon and Jensen on X with portraits", () => {
    const byId = Object.fromEntries(INFLUENTIAL_PEOPLE.map((p) => [p.id, p]));
    expect(byId.elon?.handle).toBe("elonmusk");
    expect(byId.jensen?.handle).toBe("JensenHuang");
    expect(byId.elon?.photo).toBe("/people/elon.jpg");
    expect(byId.jensen?.photo).toBe("/people/jensen.jpg");
    expect(xProfileUrl("elonmusk")).toBe("https://x.com/elonmusk");
    expect(xProfileUrl("@JensenHuang")).toBe("https://x.com/JensenHuang");
  });

  it("falls back to initials when a portrait is missing", () => {
    expect(personInitials("Field Yates")).toBe("FY");
    expect(personInitials("Matthew Berry")).toBe("MB");
    expect(personInitials("PGA Tour")).toBe("PGA");
    const missing = INFLUENTIAL_PEOPLE.filter((p) => !p.photo);
    expect(missing.map((p) => p.id).sort()).toEqual(["berry", "pga", "yates"]);
  });
});
