import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { filterParlayLegs, parlayKpis } from "./bets-parlay";
import { filterWarnings, publicKpis } from "./bets-public";
import type { ParlayLeg } from "./bets-parlay";
import type { PublicWarning } from "./bets-public";
import { fadeTone, groupSplitsByWho, type SplitsDocument } from "./bets-splits";

const FIX = path.resolve(__dirname, "../../fixtures/bets");

describe("parlay_legs fixture", () => {
  it("computes hit vs fade from committed legs", () => {
    const doc = JSON.parse(readFileSync(path.join(FIX, "parlay_legs.json"), "utf8")) as {
      legs: ParlayLeg[];
    };
    expect(doc.legs.length).toBeGreaterThan(0);
    const kpi = parlayKpis(doc.legs);
    expect(kpi.record).toMatch(/^\d+-\d+-\d+$/);
    expect(kpi.fadeRecord).toMatch(/^\d+-\d+-\d+$/);
    const lined = doc.legs.find((leg) => leg.id === "S-P-1");
    expect(lined?.line).toBe("-6.5");
  });
});

describe("public_warnings fixture", () => {
  it("computes public vs BetMGM and fade P/L", () => {
    const doc = JSON.parse(
      readFileSync(path.join(FIX, "public_warnings.json"), "utf8"),
    ) as { warnings: PublicWarning[] };
    expect(doc.warnings.length).toBeGreaterThan(0);
    const kpi = publicKpis(doc.warnings);
    expect(kpi.publicRecord).toMatch(/^\d+-\d+-\d+$/);
    expect(kpi.mgmRecord).toMatch(/^\d+-\d+-\d+$/);
    expect(kpi.fadePl).not.toBeNull();
    expect(kpi.fadeAmerican).toBe(-110);
  });
});

describe("record_splits fixture", () => {
  it("has five kinds for all-bettors and fade-edge rows", () => {
    const doc = JSON.parse(
      readFileSync(path.join(FIX, "record_splits.json"), "utf8"),
    ) as SplitsDocument;
    expect(doc.splits.length).toBeGreaterThan(0);
    const groups = groupSplitsByWho(doc.splits);
    expect(groups[0]?.who).toBe("*");
    expect(groups[0]?.rows.map((row) => row.kind)).toEqual([
      "single_team",
      "single_prop",
      "leg_team",
      "leg_prop",
      "ticket",
    ]);
    expect(doc.splits.some((row) => fadeTone(row) === "edge")).toBe(true);
    expect(doc.sports.some((row) => row.sport === "NFL")).toBe(true);
    expect(doc.checks.length).toBeGreaterThan(0);
  });
});

describe("season windows apply to parlays and public warnings", () => {
  it("keeps NFL-window rows and drops preseason ones", () => {
    const pre = { id: "pre", who: "Trent", gd: "2026-08-20", posted: "2026-08-20 12:00:00", sport: "NFL" };
    const cfb = { id: "cfb", who: "Trent", gd: "2026-08-28", posted: "2026-08-28 12:00:00", sport: "NFL" };
    const nfl = { id: "nfl", who: "Steve", gd: "2026-09-10", posted: "2026-09-10 12:00:00", sport: "NFL" };
    const legs = [pre, cfb, nfl] as unknown as ParlayLeg[];
    const warnings = [pre, cfb, nfl] as unknown as PublicWarning[];
    expect(filterParlayLegs(legs, { window: "cfb" }).map((r) => r.id)).toEqual(["cfb", "nfl"]);
    expect(filterParlayLegs(legs, { window: "nfl" }).map((r) => r.id)).toEqual(["nfl"]);
    expect(filterWarnings(warnings, { window: "nfl" }).map((r) => r.id)).toEqual(["nfl"]);
    expect(filterWarnings(warnings, { window: "all" })).toHaveLength(3);
  });
});
