import { describe, expect, it } from "vitest";

import {
  emptyFitnessDocument,
  hasLoggedTraining,
  normalizeSlices,
} from "./fitness-document";

describe("fitness document", () => {
  it("creates an empty profile for first sign-in", () => {
    const doc = emptyFitnessDocument("ada@sj.com", {
      displayName: "Ada",
      now: new Date("2026-08-22T00:00:00.000Z"),
    });
    expect(doc.email).toBe("ada@sj.com");
    expect(doc.display_name).toBe("Ada");
    expect(doc.migrated_from_anonymous).toBe(false);
    expect(doc.slices.sessions).toEqual([]);
    expect(hasLoggedTraining(doc.slices)).toBe(false);
  });

  it("drops unknown slice shapes instead of trusting the client", () => {
    const slices = normalizeSlices({
      sessions: [{ id: "s1" }],
      plannedSessions: "nope",
      recovery: [{ id: "r1" }],
      athleteProfile: "x",
      extra: 1,
    });
    expect(slices.sessions).toEqual([{ id: "s1" }]);
    expect(slices.plannedSessions).toEqual([]);
    expect(slices.recovery).toEqual([{ id: "r1" }]);
    expect(slices.athleteProfile).toBeNull();
  });

  it("treats sessions as logged training", () => {
    expect(
      hasLoggedTraining(normalizeSlices({ sessions: [{ id: "1" }] })),
    ).toBe(true);
  });
});
