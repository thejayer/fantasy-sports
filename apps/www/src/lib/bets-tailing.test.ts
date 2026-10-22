import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { americanToDecimal, parseBetTab } from "./bets";
import {
  filterTailLegs,
  pricedSportsbookLegs,
  SMALL_SAMPLE,
  tailBucket,
  tailSplits,
  type TailLeg,
  type TailingDocument,
} from "./bets-tailing";

const FIX = path.resolve(__dirname, "../../fixtures/bets");

function leg(partial: Partial<TailLeg> & Pick<TailLeg, "id" | "res">): TailLeg {
  return {
    who: "Pat",
    parent: "P-1",
    gd: "2026-09-01",
    sport: "MLB",
    pick: "Team pick",
    leg_type: "Moneyline",
    stat: "—",
    ou: "",
    sel: "Unit A",
    platform: "Sportsbook parlay",
    ticket_n: 4,
    ticket_size: "4-5 legs",
    month: "Sep",
    odds_american: null,
    ticket_implied_dec: null,
    team_type: "ML (odds not shown)",
    ...partial,
  };
}

describe("tailing math", () => {
  it("matches the −110 tail / fade formula used by the feed", () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => leg({ id: `W-${i}`, res: "W" })),
      ...Array.from({ length: 8 }, (_, i) => leg({ id: `L-${i}`, res: "L" })),
      leg({ id: "P-0", res: "Push" }),
    ];
    const rec = tailBucket(rows);
    const dec = americanToDecimal(-110) ?? 1 + 100 / 110;
    expect(rec.record).toBe("12-8-1");
    expect(rec.hit).toBeCloseTo(12 / 20);
    expect(rec.tail_110).toBeCloseTo(12 * (dec - 1) - 8);
    expect(rec.fade_110).toBeCloseTo(8 * (dec - 1) - 12);
    expect(rec.small_sample).toBe(false);
    expect(rec.signal).toBe("tail");
  });

  it("flags buckets under 20 graded legs", () => {
    const rows = Array.from({ length: SMALL_SAMPLE - 1 }, (_, i) =>
      leg({ id: `S-${i}`, res: i % 2 === 0 ? "W" : "L" }),
    );
    expect(tailBucket(rows).signal).toBe("small_sample");
    expect(tailBucket(rows).small_sample).toBe(true);
  });

  it("filters like the board chips and splits props vs teams", () => {
    const rows = [
      leg({ id: "1", res: "W", sport: "MLB", pick: "Player prop", ou: "Under", month: "Sep" }),
      leg({ id: "2", res: "L", sport: "NFL", pick: "Team pick", month: "Oct", platform: "PrizePicks" }),
      leg({ id: "3", res: "W", sport: "MLB", pick: "Player prop", ou: "Over", month: "Sep" }),
    ];
    expect(filterTailLegs(rows, { sport: "MLB" }).map((row) => row.id)).toEqual(["1", "3"]);
    expect(filterTailLegs(rows, { ou: "Under" }).map((row) => row.id)).toEqual(["1"]);
    expect(filterTailLegs(rows, { month: "Oct" }).map((row) => row.id)).toEqual(["2"]);
    const splits = tailSplits(rows);
    expect(splits.pick_group.map((row) => row.key)).toEqual(["Team pick", "Player prop"]);
    expect(splits.direction.find((row) => row.key === "Under")?.record).toBe("1-0-0");
  });

  it("priced sportsbook legs ignore PrizePicks and Surgical Six", () => {
    const rows = [
      leg({ id: "sb", res: "W", platform: "Sportsbook parlay", ticket_implied_dec: 1.7 }),
      leg({ id: "pp", res: "W", platform: "PrizePicks", ticket_implied_dec: 1.7 }),
      leg({
        id: "sx",
        res: "L",
        platform: "Surgical Six (PrizePicks)",
        ticket_implied_dec: 1.7,
      }),
      leg({ id: "bare", res: "W", platform: "Sportsbook parlay", ticket_implied_dec: null }),
    ];
    expect(pricedSportsbookLegs(rows).map((row) => row.id)).toEqual(["sb"]);
    const rec = tailBucket(pricedSportsbookLegs(rows));
    expect(rec.record).toBe("1-0-0");
    expect(rec.ticket_implied_n).toBe(1);
  });
});

describe("tailing_legs fixture", () => {
  it("recomputes the committed feed without live sheet data", () => {
    const doc = JSON.parse(readFileSync(path.join(FIX, "tailing_legs.json"), "utf8")) as TailingDocument;
    expect(doc.legs.length).toBeGreaterThan(0);
    expect(doc.source).toMatch(/fixture/);
    expect(parseBetTab("tail")).toBe("tail");
    const all = tailBucket(doc.legs);
    const view = doc.views.find((row) => row.who === "*");
    expect(view).toBeTruthy();
    expect(all.record).toBe(view?.overall.record);
    expect(all.tail_110).toBeCloseTo(view?.overall.tail_110 ?? 0);
    expect(all.fade_110).toBeCloseTo(view?.overall.fade_110 ?? 0);
  });
});
