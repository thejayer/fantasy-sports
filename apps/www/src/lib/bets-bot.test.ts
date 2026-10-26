import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { bettorKpis, filterBets, parseBetTab, uniqueBettors } from "./bets";
import {
  drivingSignals,
  formatWeight,
  parseBotBoard,
  type BotBoard,
  type BotPick,
} from "./bets-bot";

const FIX = path.resolve(__dirname, "../../fixtures/bets/bot/board.json");

describe("bot tab parsing", () => {
  it("parses tab aliases", () => {
    expect(parseBetTab("bot")).toBe("bot");
    expect(parseBetTab("sj-bot")).toBe("bot");
    expect(parseBetTab("paper")).toBe("bot");
  });
});

describe("SJ Bot never mixes into human leaderboards", () => {
  it("drops SJ Bot from uniqueBettors, filterBets, and combined KPIs", () => {
    const rows = [
      { id: "H-1", who: "Trent", res: "W", stake: 100, dec: 2, gd: "2026-09-10", units: 1, odds: "+100" },
      { id: "BOT-1", who: "SJ Bot", res: "W", stake: 100, dec: 2, gd: "2026-09-10", units: 1, odds: "+100" },
    ];
    expect(uniqueBettors(rows)).toEqual(["Trent"]);
    expect(filterBets(rows as never).map((r) => r.id)).toEqual(["H-1"]);
    const kpi = bettorKpis(rows as never);
    expect(kpi.bets).toBe(1);
    expect(kpi.wins).toBe(1);
  });
});

describe("bot board fixture", () => {
  it("is labeled simulated and has the day-one surfaces", () => {
    const doc = JSON.parse(readFileSync(FIX, "utf8")) as BotBoard;
    expect(doc.simulated).toBe(true);
    expect(doc.simulated_label).toMatch(/simulated/i);
    expect(doc.who).toBe("SJ Bot");
    expect(doc.record).toMatch(/^\d+-\d+-\d+$/);
    expect(doc.open.length).toBeGreaterThan(0);
    expect(doc.recent.length).toBeGreaterThan(0);
    expect(doc.weights.length).toBeGreaterThan(0);
    expect(doc.note?.body).toBeTruthy();
    expect(doc.bankroll_series.length).toBeGreaterThan(1);
    const parsed = parseBotBoard(doc);
    expect(parsed?.simulated).toBe(true);
    const first = doc.recent[0] as BotPick;
    expect(first.reason).toBeTruthy();
    expect(drivingSignals(first).length).toBeGreaterThan(0);
    expect(formatWeight(0.5)).toBe("50%");
  });
});
