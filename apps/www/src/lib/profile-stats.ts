/** The few casino numbers /profile shows, from the casino's own /api/profile and /api/card replies. */

export type StatTile = { id: string; label: string; value: string; hint?: string };

type ProfileLike = {
  chips?: number;
  streak?: number;
  fantasyChips?: number;
  fantasyWins?: number;
  trophies?: unknown[];
};
type CardLike = {
  spins?: number;
  biggestWin?: number;
  bestMultiplier?: number;
  ranks?: { win: number | null; mult: number | null; jackpots: number | null };
};

const nf = new Intl.NumberFormat("en-US");
const num = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/** The best (lowest) all-time rank across the casino boards, or null when unranked. */
export function bestRank(ranks: CardLike["ranks"]): { rank: number; board: string } | null {
  if (!ranks) return null;
  const boards: [string, number | null][] = [
    ["biggest win", ranks.win],
    ["best multiplier", ranks.mult],
    ["jackpots", ranks.jackpots],
  ];
  let best: { rank: number; board: string } | null = null;
  for (const [board, rank] of boards) {
    if (typeof rank === "number" && rank > 0 && (!best || rank < best.rank)) best = { rank, board };
  }
  return best;
}

export function statTiles(profile: ProfileLike, card: CardLike): StatTile[] {
  const rank = bestRank(card.ranks);
  const streak = num(profile.streak);
  const wins = num(profile.fantasyWins);
  return [
    { id: "chips", label: "Chips", value: nf.format(Math.round(num(profile.chips))) },
    { id: "rank", label: "Best rank", value: rank ? `#${rank.rank}` : "–", hint: rank ? rank.board : "not ranked yet" },
    { id: "streak", label: "Play streak", value: `${streak} ${streak === 1 ? "day" : "days"}` },
    { id: "spins", label: "Spins", value: nf.format(num(card.spins)) },
    { id: "win", label: "Biggest win", value: nf.format(Math.round(num(card.biggestWin))) },
    {
      id: "mult",
      label: "Best multiplier",
      value: num(card.bestMultiplier) > 0 ? `${nf.format(num(card.bestMultiplier))}x` : "–",
    },
    {
      id: "fantasy",
      label: "Fantasy chips",
      value: nf.format(Math.round(num(profile.fantasyChips))),
      hint: `${wins} matchup ${wins === 1 ? "win" : "wins"}`,
    },
    { id: "trophies", label: "Trophies", value: String(profile.trophies?.length ?? 0) },
  ];
}
