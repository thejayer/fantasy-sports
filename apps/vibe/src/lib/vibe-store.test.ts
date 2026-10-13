import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { mergeWorkouts, upsertWorkouts, vibeDocumentPath } from "./vibe-store";
import type { Workout } from "./vibe-document";

const roots: string[] = [];

function workout(id: string): Workout {
  return {
    id: `hae:${id}`,
    source: "health_auto_export",
    source_id: id,
    name: "Lift",
    type: "Lift",
    start: "2026-10-05T11:00:00.000Z",
    end: "2026-10-05T12:00:00.000Z",
    duration_sec: 3600,
    active_energy_kcal: 300,
    distance_m: null,
    avg_hr: null,
    max_hr: null,
  };
}

describe("vibe store", () => {
  afterEach(() => {
    delete process.env.SJ_VIBE_DIR;
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("dedupes workouts on source+source_id", () => {
    const a = workout("same");
    const b = { ...workout("same"), name: "Other name" };
    const merged = mergeWorkouts([a], [b, workout("other")]);
    expect(merged).toHaveLength(2);
    expect(merged.find((row) => row.source_id === "same")?.name).toBe("Lift");
  });

  it("writes under users/<email-hash>/vibe.json", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "vibe-"));
    roots.push(root);
    process.env.SJ_VIBE_DIR = root;
    const actor = {
      email: "austin@example.com",
      name: "Austin",
      image: null,
      source: "bypass" as const,
    };
    await upsertWorkouts(actor, [workout("one")]);
    const file = vibeDocumentPath(actor.email);
    expect(file.startsWith(path.join(root, "users"))).toBe(true);
    expect(file.endsWith(`${path.sep}vibe.json`)).toBe(true);
  });
});
