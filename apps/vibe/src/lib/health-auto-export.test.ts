import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { parseHealthAutoExport } from "./health-auto-export";

const fixture = JSON.parse(
  readFileSync(
    path.join(__dirname, "../fixtures/health-auto-export.json"),
    "utf8",
  ),
) as unknown;

describe("Health Auto Export parse", () => {
  it("reads the documented v2 envelope", () => {
    const rows = parseHealthAutoExport(fixture);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe("Traditional Strength Training");
    expect(rows[0]?.start).toBe("2026-10-05T11:00:00.000Z");
    expect(rows[0]?.end).toBe("2026-10-05T12:15:00.000Z");
    expect(rows[0]?.duration_sec).toBe(4500);
    expect(rows[0]?.active_energy_kcal).toBe(412);
    expect(rows[0]?.avg_hr).toBe(138);
    expect(rows[0]?.max_hr).toBe(172);
    expect(rows[0]?.source).toBe("health_auto_export");
  });

  it("accepts a raw array, v1 activeEnergy, and a single object", () => {
    const one = parseHealthAutoExport({
      name: "Running",
      start: "2024-02-06 07:00:00 -0800",
      end: "2024-02-06 07:30:00 -0800",
      duration: 1800,
      activeEnergy: { qty: 350, units: "kcal" },
    });
    expect(one).toHaveLength(1);
    expect(one[0]?.active_energy_kcal).toBe(350);
    expect(one[0]?.start).toBe("2024-02-06T15:00:00.000Z");
  });

  it("is idempotent on the same workout id", () => {
    const once = parseHealthAutoExport(fixture);
    const twice = parseHealthAutoExport({
      workouts: [
        ...(fixture as { data: { workouts: unknown[] } }).data.workouts,
        (fixture as { data: { workouts: unknown[] } }).data.workouts[0],
      ],
    });
    expect(twice).toHaveLength(once.length);
  });

  it("skips rows without a parseable window", () => {
    expect(
      parseHealthAutoExport({ workouts: [{ name: "Nope", start: "bogus" }] }),
    ).toEqual([]);
  });
});
