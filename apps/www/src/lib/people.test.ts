import { describe, expect, it } from "vitest";

import {
  INFLUENTIAL_PEOPLE,
  PEOPLE_LANES,
  isXHandle,
  peopleByLane,
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
      expect(person.blurb.trim().length).toBeGreaterThan(12);
    }
    const grouped = peopleByLane();
    expect(grouped.map((g) => g.lane)).toEqual([...PEOPLE_LANES]);
    expect(grouped.flatMap((g) => g.people)).toHaveLength(
      INFLUENTIAL_PEOPLE.length,
    );
  });

  it("includes Elon and Jensen on X", () => {
    const byId = Object.fromEntries(INFLUENTIAL_PEOPLE.map((p) => [p.id, p]));
    expect(byId.elon?.handle).toBe("elonmusk");
    expect(byId.jensen?.handle).toBe("JensenHuang");
    expect(xProfileUrl("elonmusk")).toBe("https://x.com/elonmusk");
    expect(xProfileUrl("@JensenHuang")).toBe("https://x.com/JensenHuang");
  });
});
