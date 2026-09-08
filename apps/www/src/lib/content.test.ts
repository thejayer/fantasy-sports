import { describe, expect, it } from "vitest";

import {
  crewInitials,
  formatPortalEventChip,
  formatPortalEventDate,
  portalCopy,
  readyCrewMembers,
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
    expect(upcoming.map((e) => e.label)).toEqual([
      "Golf season kickoff",
      "Thursday night watch",
      "Waiver-week hang",
    ]);
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

describe("formatPortalEventChip", () => {
  it("splits month and day for stacked cards", () => {
    expect(formatPortalEventChip("2026-09-12")).toEqual({
      month: "Sep",
      day: "12",
    });
  });
});

describe("portal destinations", () => {
  it("keeps Palworld pending-friendly copy", () => {
    expect(portalCopy.destinations.items.palworld.actionPending).toBe("Soon");
  });

  it("lists crew handles for hub /u deep-links", () => {
    for (const member of portalCopy.crew.members) {
      expect(member.handle).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("includes a People destination", () => {
    expect(portalCopy.destinations.items.people.title).toBe("People");
    expect(portalCopy.destinations.secondary).toContain("people");
  });

  it("includes a Fitness destination", () => {
    expect(portalCopy.destinations.items.fitness.title).toBe("Fitness");
    expect(portalCopy.destinations.items.fitness.action).toBe("Open Fitness");
  });

  it("splits primary rooms from compact stubs", () => {
    expect([...portalCopy.destinations.primary]).toEqual([
      "fantasy",
      "fitness",
      "discord",
      "watch",
    ]);
    expect([...portalCopy.destinations.secondary]).toEqual([
      "ai",
      "people",
      "palworld",
    ]);
    expect(portalCopy.destinations.items.fantasy.title).toBe("Fantasy");
  });
});

describe("readyCrewMembers", () => {
  it("omits shells without a bio or ready:false", () => {
    expect(
      readyCrewMembers([
        { handle: "jay", name: "Jay", blurb: "Here.", ready: true },
        { handle: "empty", name: "Empty", blurb: "", ready: true },
        { handle: "later", name: "Later", blurb: "Soon.", ready: false },
      ]).map((m) => m.handle),
    ).toEqual(["jay"]);
  });

  it("builds two-letter initials", () => {
    expect(crewInitials("The Cap")).toBe("TC");
    expect(crewInitials("Jay")).toBe("JA");
  });
});
