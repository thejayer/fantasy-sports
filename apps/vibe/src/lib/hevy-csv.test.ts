import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { parseAgentRunCsv, parseHevyWorkoutCsv } from "./hevy-csv";

const csv = readFileSync(
  path.join(__dirname, "../fixtures/hevy-workouts.csv"),
  "utf8",
);

describe("Hevy / agent CSV", () => {
  it("reads start/end/type columns", () => {
    const rows = parseHevyWorkoutCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe("Traditional Strength Training");
    expect(rows[0]?.source).toBe("hevy");
  });

  it("parses agent windows", () => {
    const rows = parseAgentRunCsv(
      "start,end,label\n2026-10-09T11:10:00Z,2026-10-09T11:55:00Z,cloud\n",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("cloud");
  });
});
