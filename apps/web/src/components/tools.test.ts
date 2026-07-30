import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("decision tools UI (roadmap 4.5)", () => {
  it("ToolsPanel ships trade, waivers, strength, draft, start/sit, and playoff odds", () => {
    const source = readFileSync(
      path.resolve(__dirname, "ToolsPanel.tsx"),
      "utf8",
    );
    expect(source).toMatch(/TradeAnalyzer/);
    expect(source).toMatch(/WaiverBoard/);
    expect(source).toMatch(/DraftBoard/);
    expect(source).toMatch(/StartSitBoard/);
    expect(source).toMatch(/PlayoffOddsBoard/);
    expect(source).toMatch(/id: "trade"/);
    expect(source).toMatch(/id: "waivers"/);
    expect(source).toMatch(/id: "strength"/);
    expect(source).toMatch(/id: "draft"/);
    expect(source).toMatch(/id: "start-sit"/);
    expect(source).toMatch(/id: "playoff-odds"/);
    expect(source).toMatch(/export-playoff-odds|No weekly projection|availableDraftSlots/);
    expect(source).not.toMatch(/id: "deferred"/);
    expect(source).not.toMatch(/child_process|spawn\(/);
  });

  it("TradeAnalyzer syncs team pair to ?a=&b= and stays client-side", () => {
    const source = readFileSync(
      path.resolve(__dirname, "TradeAnalyzer.tsx"),
      "utf8",
    );
    expect(source).toMatch(/"use client"/);
    expect(source).toMatch(/evaluateTrade/);
    expect(source).toMatch(/playoffOddsSamples|make-playoffs/);
    expect(source).toMatch(/params\.set\("a"/);
    expect(source).toMatch(/params\.set\("b"/);
    expect(source).not.toMatch(/child_process|ffa draft-sim|spawn\(/);
  });

  it("StartSitBoard uses dedicated ?team= (not trade a/b)", () => {
    const source = readFileSync(
      path.resolve(__dirname, "StartSitBoard.tsx"),
      "utf8",
    );
    expect(source).toMatch(/params\.set\("team"/);
    expect(source).toMatch(/params\.delete\("a"\)/);
  });

  it("DraftBoard only offers availableSlots chips", () => {
    const source = readFileSync(
      path.resolve(__dirname, "DraftBoard.tsx"),
      "utf8",
    );
    expect(source).toMatch(/availableSlots/);
    expect(source).not.toMatch(/maxSlot/);
  });
});
