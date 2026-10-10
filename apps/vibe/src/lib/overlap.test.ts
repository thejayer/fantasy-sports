import { describe, expect, it } from "vitest";

import {
  agentMinutesInWindow,
  eventsInWindow,
  instantInWindow,
  overlapMinutes,
  workoutWindow,
} from "./overlap";
import { scoreFromCounts, scoreWorkout } from "./score";
import type { AgentRun, CodingEvent, Workout } from "./vibe-document";

function workout(start: string, end: string): Workout {
  return {
    id: "w1",
    source: "health_auto_export",
    source_id: "w1",
    name: "Lift",
    type: "Traditional Strength Training",
    start,
    end,
    duration_sec: (Date.parse(end) - Date.parse(start)) / 1000,
    active_energy_kcal: 400,
    distance_m: null,
    avg_hr: 140,
    max_hr: 170,
  };
}

function event(id: string, at: string, kind: CodingEvent["kind"] = "commit"): CodingEvent {
  return {
    id,
    kind,
    at,
    repo: "thejayer/fantasy-sports-analytics",
    title: id,
    url: "https://github.com/thejayer/fantasy-sports-analytics",
    additions: 10,
    deletions: 2,
    sha: id,
  };
}

describe("overlap / buffer", () => {
  const session = workout("2026-10-05T11:00:00.000Z", "2026-10-05T12:15:00.000Z");

  it("expands the window by the buffer on both sides", () => {
    const window = workoutWindow(session, 15);
    expect(window?.start.toISOString()).toBe("2026-10-05T10:45:00.000Z");
    expect(window?.end.toISOString()).toBe("2026-10-05T12:30:00.000Z");
  });

  it("allows a zero buffer and clamps nothing here", () => {
    const window = workoutWindow(session, 0);
    expect(window?.start.toISOString()).toBe(session.start);
    expect(window?.end.toISOString()).toBe(session.end);
  });

  it("counts a commit in the pre-workout buffer and rejects one just outside", () => {
    const window = workoutWindow(session, 15)!;
    expect(
      instantInWindow(new Date("2026-10-05T10:50:00.000Z"), window),
    ).toBe(true);
    expect(
      instantInWindow(new Date("2026-10-05T10:44:59.000Z"), window),
    ).toBe(false);
  });

  it("counts a midnight-crossing workout against events on both calendar days", () => {
    const night = workout("2026-10-11T04:30:00.000Z", "2026-10-11T05:30:00.000Z");
    const window = workoutWindow(night, 15)!;
    const events: CodingEvent[] = [
      event("before", "2026-10-11T04:20:00.000Z"),
      event("after", "2026-10-11T05:40:00.000Z"),
      event("outside", "2026-10-11T06:00:00.000Z"),
    ];
    expect(eventsInWindow(events, window).map((row) => row.id)).toEqual([
      "before",
      "after",
    ]);
  });

  it("computes overlapping agent minutes only on the intersection", () => {
    const window = workoutWindow(session, 15)!;
    const runs: AgentRun[] = [
      {
        id: "a1",
        start: "2026-10-05T12:00:00.000Z",
        end: "2026-10-05T12:45:00.000Z",
        label: "cloud",
        source: "ingest",
      },
    ];
    expect(agentMinutesInWindow(runs, window)).toBe(30);
    expect(
      overlapMinutes(window, {
        start: new Date("2026-10-05T09:00:00.000Z"),
        end: new Date("2026-10-05T10:00:00.000Z"),
      }),
    ).toBe(0);
  });

  it("scores commits, weighted PRs, and agent minutes", () => {
    expect(
      scoreFromCounts({
        commits: 3,
        prs_opened: 1,
        prs_merged: 1,
        reviews: 1,
        comments: 2,
        agent_minutes: 10,
      }),
    ).toBe(11);
    const scored = scoreWorkout(
      session,
      [
        event("c1", "2026-10-05T11:10:00.000Z"),
        event("pr", "2026-10-05T11:20:00.000Z", "pr_opened"),
      ],
      [],
      15,
    );
    expect(scored?.score).toBe(3);
    expect(scored?.commits).toBe(1);
  });
});
