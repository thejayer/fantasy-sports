import { describe, expect, it } from "vitest";

import { commitStreak, homeStats } from "./stats";
import { scoreWorkouts } from "./score";
import { buildDemoDocument } from "@/fixtures/demo";

describe("home stats", () => {
  const now = new Date("2026-10-10T17:00:00.000Z");
  const doc = buildDemoDocument("austin@example.com", now);
  const rows = scoreWorkouts(
    doc.workouts,
    doc.events,
    doc.agent_runs,
    doc.settings.buffer_minutes,
  );

  it("puts this week's sessions on the home board", () => {
    const home = homeStats(rows, "America/Chicago", now);
    expect(home.week.length).toBeGreaterThan(0);
    expect(home.weekCommits).toBeGreaterThan(0);
    expect(home.top?.score).toBeGreaterThan(0);
  });

  it("counts a commit streak from qualifying days", () => {
    expect(commitStreak(rows, "America/Chicago", now)).toBeGreaterThan(0);
  });
});
