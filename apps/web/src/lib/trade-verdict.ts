/**
 * Human-readable trade verdict (roadmap 7.8).
 *
 * Uses season median / VOR deltas already computed by evaluateTrade. Floor and
 * ceiling band the uncertainty the posterior already provides — the store has
 * no joint sample matrix, so this is directional, not a Monte Carlo net.
 */

import type { TradeSideDelta } from "@/lib/decision-tools";

export type TradeVerdict = {
  /** Which side gains on median season points, or "even". */
  favors: "a" | "b" | "even";
  /** Absolute median-point edge for the favored side (0 when even). */
  medianEdge: number;
  /** Absolute VOR edge for the favored side. */
  vorEdge: number;
  /** One-line summary for the analyzer. */
  headline: string;
  /** Uncertainty note from floor/ceiling movement. */
  uncertainty: string;
};

const EVEN_MEDIAN = 1.0; // points — below this is a wash

export function tradeVerdict(
  sideA: TradeSideDelta,
  sideB: TradeSideDelta,
  nameA: string,
  nameB: string,
): TradeVerdict {
  const dMedA = sideA.deltaMedian;
  const dMedB = sideB.deltaMedian;
  // Favor the side with the larger median gain (or smaller loss).
  const edgeAoverB = dMedA - dMedB;
  let favors: TradeVerdict["favors"] = "even";
  if (edgeAoverB > EVEN_MEDIAN) favors = "a";
  else if (edgeAoverB < -EVEN_MEDIAN) favors = "b";

  const medianEdge = Math.abs(edgeAoverB);
  const vorEdge = Math.abs(sideA.deltaVor - sideB.deltaVor);

  const fmt = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
  let headline: string;
  if (favors === "even") {
    headline = `Roughly even on season median (${fmt(dMedA)} vs ${fmt(dMedB)}).`;
  } else if (favors === "a") {
    headline = `Favors ${nameA} by ${medianEdge.toFixed(1)} median points (${fmt(dMedA)} vs ${fmt(dMedB)}).`;
  } else {
    headline = `Favors ${nameB} by ${medianEdge.toFixed(1)} median points (${fmt(dMedB)} vs ${fmt(dMedA)}).`;
  }

  const floorA = sideA.after.floor - sideA.before.floor;
  const ceilA = sideA.after.ceiling - sideA.before.ceiling;
  const floorB = sideB.after.floor - sideB.before.floor;
  const ceilB = sideB.after.ceiling - sideB.before.ceiling;
  const uncertainty = `Floor/ceiling move ${fmt(floorA)}/${fmt(ceilA)} for ${nameA}, ${fmt(floorB)}/${fmt(ceilB)} for ${nameB}. Quantiles are summed independently — direction, not a joint Monte Carlo.`;

  return {
    favors,
    medianEdge: favors === "even" ? 0 : medianEdge,
    vorEdge: favors === "even" ? 0 : vorEdge,
    headline,
    uncertainty,
  };
}

/**
 * Bounded two-for-one Trade Finder (roadmap 7.8).
 * Enumerates packages where A sends 2 and receives 1 (and the reverse) ranked
 * by joint improvement: both sides' median deltas positive, or sum of deltas.
 */
export type TradeFinderPackage = {
  giveIds: string[];
  getIds: string[];
  /** give = from A, get = from B */
  sideADeltaMedian: number;
  sideBDeltaMedian: number;
  jointMedian: number;
  giveNames: string[];
  getNames: string[];
};

export function rankTradePackages(
  packages: TradeFinderPackage[],
  limit = 10,
): TradeFinderPackage[] {
  return packages
    .slice()
    .sort(
      (a, b) =>
        b.jointMedian - a.jointMedian ||
        b.sideADeltaMedian - a.sideADeltaMedian,
    )
    .slice(0, limit);
}
