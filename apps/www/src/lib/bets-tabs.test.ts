import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parlayKpis } from "./bets-parlay";
import { publicKpis } from "./bets-public";
import type { ParlayLeg } from "./bets-parlay";
import type { PublicWarning } from "./bets-public";

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
