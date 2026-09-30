import { describe, expect, it } from "vitest";

import { hockeyGroup, hockeyPositionLabel } from "@/lib/hockey-position";

describe("hockey positions", () => {
  it("collapses ESPN positions to F / D / G", () => {
    for (const p of ["C", "LW", "RW", "F", "Center", "Left Wing", "right wing"]) {
      expect(hockeyGroup(p)).toBe("F");
    }
    expect(hockeyGroup("D")).toBe("D");
    expect(hockeyGroup("Goalie")).toBe("G");
    expect(hockeyGroup(null)).toBeNull();
    expect(hockeyGroup("Util")).toBeNull();
  });

  it("labels the roster Position cell, noting bench and IR", () => {
    expect(hockeyPositionLabel("LW", "F")).toBe("F");
    expect(hockeyPositionLabel("RW", "Util")).toBe("F");
    expect(hockeyPositionLabel("D", "BE")).toBe("D · Bench");
    expect(hockeyPositionLabel("G", "IR")).toBe("G · IR");
    expect(hockeyPositionLabel(null, "D")).toBe("D");
    expect(hockeyPositionLabel(null, null)).toBe("—");
  });
});
