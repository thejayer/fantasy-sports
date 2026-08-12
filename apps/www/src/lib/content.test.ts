import { describe, expect, it } from "vitest";

import {
  formatPortalEventDate,
  portalCopy,
  upcomingPortalEvents,
} from "./content";

describe("upcomingPortalEvents", () => {
  const items = portalCopy.events.items;

  it("keeps events on or after today (UTC), oldest first", () => {
    const now = new Date("2026-08-12T15:00:00.000Z");
    const upcoming = upcomingPortalEvents(items, now, 3);
    expect(upcoming.map((e) => e.date)).toEqual([
      "2026-08-16",
      "2026-09-01",
      "2026-09-12",
    ]);
  });

  it("drops past events", () => {
    const now = new Date("2026-09-02T12:00:00.000Z");
    const upcoming = upcomingPortalEvents(items, now, 5);
    expect(upcoming.map((e) => e.label)).toEqual(["Golf season kickoff"]);
  });

  it("returns empty when nothing remains", () => {
    const now = new Date("2027-01-01T00:00:00.000Z");
    expect(upcomingPortalEvents(items, now)).toEqual([]);
  });
});

describe("formatPortalEventDate", () => {
  it("formats ISO dates in UTC", () => {
    expect(formatPortalEventDate("2026-09-01")).toMatch(/Sep/);
    expect(formatPortalEventDate("2026-09-01")).toMatch(/1/);
  });
});

describe("portal destinations", () => {
  it("keeps Palworld pending-friendly copy", () => {
    expect(portalCopy.destinations.items.palworld.actionPending).toBe(
      "Details soon",
    );
  });

  it("lists crew handles for hub /u deep-links", () => {
    for (const member of portalCopy.crew.members) {
      expect(member.handle).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
