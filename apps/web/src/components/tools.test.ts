import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("decision tools UI (roadmap 4.5)", () => {
  it("ToolsPanel ships trade, waivers, strength, and honest deferrals", () => {
    const source = readFileSync(
      path.resolve(__dirname, "ToolsPanel.tsx"),
      "utf8",
    );
    expect(source).toMatch(/TradeAnalyzer/);
    expect(source).toMatch(/WaiverBoard/);
    expect(source).toMatch(/id: "trade"/);
    expect(source).toMatch(/id: "waivers"/);
    expect(source).toMatch(/id: "strength"/);
    expect(source).toMatch(/Draft assistant/);
    expect(source).toMatch(/Playoff odds/);
    expect(source).toMatch(/free agents/);
  });

  it("TradeAnalyzer is client-side package selection over season totals", () => {
    const source = readFileSync(
      path.resolve(__dirname, "TradeAnalyzer.tsx"),
      "utf8",
    );
    expect(source).toMatch(/"use client"/);
    expect(source).toMatch(/evaluateTrade/);
    expect(source).toMatch(/independent/);
    expect(source).not.toMatch(/child_process|ffa draft-sim|spawn\(/);
  });
});
