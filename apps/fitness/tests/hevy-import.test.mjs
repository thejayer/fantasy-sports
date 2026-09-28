import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadHevyImportContext } from "./helpers/loadAppContext.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  path.join(__dirname, "fixtures", "hevy_workouts.csv"),
  "utf8",
);

const KG_CSV = `title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe
Squat Day,"01 Apr 2025, 06:10","01 Apr 2025, 07:05",,"Back Squat",,,0,normal,100,5,,,8
`;

const ID_CSV = `workout_id,title,start_time,exercise_title,set_index,weight_lbs,reps,rpe
abc123,ID Workout,2025-04-02 18:00,Deadlift,1,315,3,9
`;

function importFixture(ctx, csv = FIXTURE, existing = []) {
  const workouts = ctx.parseHevyCsv(csv);
  const sessions = ctx.hevyWorkoutsToSessions(workouts);
  return { workouts, sessions, ...ctx.mergeHevySessions(existing, sessions) };
}

describe("parseHevyCsv", () => {
  it("groups official Hevy rows into workouts and keeps set fields", () => {
    const ctx = loadHevyImportContext();
    const workouts = ctx.parseHevyCsv(FIXTURE);
    expect(workouts).toHaveLength(2);
    expect(workouts[0].title).toBe("Push Day");
    expect(workouts[0].rows).toHaveLength(3);
    expect(workouts[1].title).toBe("Pull Day");
    expect(workouts[1].description).toBe("");
  });

  it("accepts a workout_id column when Hevy includes one", () => {
    const ctx = loadHevyImportContext();
    const workouts = ctx.parseHevyCsv(ID_CSV);
    expect(workouts).toHaveLength(1);
    expect(workouts[0].workoutId).toBe("abc123");
    expect(ctx.hevyImportKey(workouts[0])).toBe("hevy:id:abc123");
  });

  it("rejects a non-Hevy CSV", () => {
    const ctx = loadHevyImportContext();
    expect(() => ctx.parseHevyCsv("date,type,duration\n2025-01-01,Run,30")).toThrow(
      /Hevy workout CSV/,
    );
  });
});

describe("hevyWorkoutsToSessions", () => {
  it("maps workouts to lifting sessions with lbs, date, RPE, notes, and duration", () => {
    const ctx = loadHevyImportContext();
    const { sessions } = importFixture(ctx);
    expect(sessions).toHaveLength(2);

    const push = sessions.find((session) => session.note.startsWith("Push Day"));
    expect(push.type).toBe("Lifting");
    expect(push.date).toBe("2025-03-28");
    expect(push.durationMinutes).toBe(46);
    expect(push.source).toBe("hevy");
    expect(push.importKey).toMatch(/^hevy:ts:push-day\|/);
    expect(push.id).toBe(push.importKey);
    expect(push.sets).toEqual([
      { exercise: "Bench Press (Barbell)", set: 1, reps: 8, weight: 185, rpe: 8 },
      { exercise: "Bench Press (Barbell)", set: 2, reps: 7, weight: 185, rpe: 8.5 },
      { exercise: "Overhead Press (Barbell)", set: 1, reps: 6, weight: 95, rpe: 7 },
    ]);
    expect(push.note).toContain("Felt strong");
    expect(push.note).toContain("Pause at the bottom");
    expect(push.effortScore).toBe(8);
  });

  it("converts weight_kg to pounds", () => {
    const ctx = loadHevyImportContext();
    const { sessions } = importFixture(ctx, KG_CSV);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sets[0].weight).toBe(220.5);
    expect(sessions[0].date).toBe("2025-04-01");
  });
});

describe("mergeHevySessions", () => {
  it("is idempotent for the same CSV", () => {
    const ctx = loadHevyImportContext();
    const first = importFixture(ctx);
    expect(first.imported).toBe(2);
    expect(first.skipped).toBe(0);

    const second = ctx.mergeHevySessions(first.sessions, first.sessions);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.sessions).toHaveLength(2);
  });

  it("keeps Ada and Bob logs isolated when both import the same fixture", () => {
    const ctx = loadHevyImportContext();
    const adaExisting = [{ id: "ada-only", type: "Lifting", date: "2025-01-01", sets: [] }];
    const bobExisting = [{ id: "bob-only", type: "Lifting", date: "2025-01-02", sets: [] }];

    const ada = importFixture(ctx, FIXTURE, adaExisting);
    const bob = importFixture(ctx, FIXTURE, bobExisting);

    expect(ada.sessions.map((session) => session.id)).toContain("ada-only");
    expect(ada.sessions.map((session) => session.id)).not.toContain("bob-only");
    expect(bob.sessions.map((session) => session.id)).toContain("bob-only");
    expect(bob.sessions.map((session) => session.id)).not.toContain("ada-only");
    expect(ada.imported).toBe(2);
    expect(bob.imported).toBe(2);
  });
});

describe("Hevy import wiring", () => {
  it("saves through the store, not anonymous athleteLog.sessions.v1", () => {
    const events = readFileSync(
      path.join(__dirname, "..", "public", "events.js"),
      "utf8",
    );
    expect(events).toContain("mergeHevySessions");
    expect(events).toContain("isSignedInFitnessMember");
    expect(events).toContain("store.updateSessions");
    expect(events).not.toContain("athleteLog.sessions.v1");
  });
});

describe("isSignedInFitnessMember", () => {
  it("accepts a namespaced member prefix and rejects anonymous athleteLog keys", () => {
    const ctx = loadHevyImportContext();
    expect(
      ctx.isSignedInFitnessMember({
        user: { email: "ada@sj.com" },
        storagePrefix: "athleteLog." + "a".repeat(32),
      }),
    ).toBe(true);
    expect(
      ctx.isSignedInFitnessMember({
        user: { email: "ada@sj.com" },
        storagePrefix: "athleteLog",
      }),
    ).toBe(false);
    expect(
      ctx.isSignedInFitnessMember({
        user: { email: "ada@sj.com" },
        storagePrefix: "athleteLog.guest",
      }),
    ).toBe(false);
    expect(ctx.isSignedInFitnessMember({ storagePrefix: "athleteLog." + "b".repeat(32) })).toBe(
      false,
    );
  });
});
