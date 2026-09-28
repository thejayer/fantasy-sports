/**
 * Live golf auction nomination room — pure state machine (roadmap live room).
 * File-backed + polled from the hub; no websockets/Redis.
 */

import {
  owgrPool,
  poolSizeForLeague,
  type GolfDraftPick,
  type OwgrPlayer,
} from "@/lib/golf-draft";
import { GOLF_STARTERS } from "@/lib/golf";

export type AuctionRoomPhase =
  | "lobby"
  | "nominate"
  | "bidding"
  | "complete"
  | "finalized";

export type AuctionLot = {
  player_id: number;
  player_name: string;
  nominating_team_id: number;
  high_bid: number;
  high_bidder_team_id: number | null;
  opened_at: string;
  bid_ends_at: string;
  hard_ends_at: string;
  passed_team_ids: number[];
};

export type AuctionRoom = {
  schema_version: 1;
  league_id: string;
  season: number;
  updated_at: string;
  revision: number;
  phase: AuctionRoomPhase;
  budget: number;
  starters: number;
  roster_slots: number;
  team_ids: number[];
  team_names: Record<string, string>;
  nominator_idx: number;
  auction_round: number;
  budgets: Record<string, number>;
  roster_counts: Record<string, number>;
  /** Remaining OWGR player ids (best first). */
  available_player_ids: number[];
  player_names: Record<string, string>;
  picks: GolfDraftPick[];
  current: AuctionLot | null;
  bid_window_ms: number;
  bid_hard_cap_ms: number;
};

export const DEFAULT_BID_WINDOW_MS = 15_000;
export const DEFAULT_BID_HARD_CAP_MS = 45_000;

export type CreateRoomInput = {
  league_id: string;
  season: number;
  team_ids: number[];
  team_names: Record<string, string>;
  budget: number;
  starters?: number;
  bench: number;
  now?: Date;
  bid_window_ms?: number;
  bid_hard_cap_ms?: number;
  pool?: OwgrPlayer[];
};

function iso(now: Date): string {
  return now.toISOString();
}

function tid(id: number): string {
  return String(id);
}

export function maxBidForTeam(room: AuctionRoom, teamId: number): number {
  const open = room.roster_slots - (room.roster_counts[tid(teamId)] ?? 0);
  if (open <= 0) return 0;
  return (room.budgets[tid(teamId)] ?? 0) - (open - 1);
}

export function createAuctionRoom(input: CreateRoomInput): AuctionRoom {
  if (input.team_ids.length < 2) {
    throw new Error("auction room needs at least 2 teams");
  }
  const starters = input.starters ?? GOLF_STARTERS;
  const rosterSlots = starters + input.bench;
  const size = poolSizeForLeague(input.team_ids.length, starters, input.bench);
  const pool = input.pool ?? owgrPool(size);
  const now = input.now ?? new Date();
  const budgets: Record<string, number> = {};
  const rosterCounts: Record<string, number> = {};
  for (const id of input.team_ids) {
    budgets[tid(id)] = input.budget;
    rosterCounts[tid(id)] = 0;
  }
  const playerNames: Record<string, string> = {};
  for (const p of pool) playerNames[tid(p.id)] = p.name;

  return {
    schema_version: 1,
    league_id: input.league_id,
    season: input.season,
    updated_at: iso(now),
    revision: 1,
    phase: "lobby",
    budget: input.budget,
    starters,
    roster_slots: rosterSlots,
    team_ids: [...input.team_ids],
    team_names: { ...input.team_names },
    nominator_idx: 0,
    auction_round: 1,
    budgets,
    roster_counts: rosterCounts,
    available_player_ids: pool.map((p) => p.id),
    player_names: playerNames,
    picks: [],
    current: null,
    bid_window_ms: input.bid_window_ms ?? DEFAULT_BID_WINDOW_MS,
    bid_hard_cap_ms: input.bid_hard_cap_ms ?? DEFAULT_BID_HARD_CAP_MS,
  };
}

function bump(room: AuctionRoom, now: Date): AuctionRoom {
  return {
    ...room,
    revision: room.revision + 1,
    updated_at: iso(now),
  };
}

function nextNominatorIdx(room: AuctionRoom, fromIdx: number): number {
  const n = room.team_ids.length;
  for (let step = 1; step <= n; step += 1) {
    const idx = (fromIdx + step) % n;
    const teamId = room.team_ids[idx]!;
    if ((room.roster_counts[tid(teamId)] ?? 0) < room.roster_slots) {
      return idx;
    }
  }
  return fromIdx;
}

function allRostersFull(room: AuctionRoom): boolean {
  return room.team_ids.every(
    (id) => (room.roster_counts[tid(id)] ?? 0) >= room.roster_slots,
  );
}

function sellLot(room: AuctionRoom, now: Date): AuctionRoom {
  const lot = room.current;
  if (!lot || lot.high_bidder_team_id == null || lot.high_bid < 1) {
    throw new Error("cannot sell lot without a high bidder");
  }
  const winner = lot.high_bidder_team_id;
  const price = lot.high_bid;
  const pickNum =
    room.picks.filter((p) => p.round === room.auction_round).length + 1;
  const pick: GolfDraftPick = {
    round: room.auction_round,
    round_pick: pickNum,
    team_id: winner,
    player_id: lot.player_id,
    player_name: lot.player_name,
    bid_amount: price,
    keeper: false,
    nominating_team_id: lot.nominating_team_id,
  };

  const budgets = { ...room.budgets };
  budgets[tid(winner)] = (budgets[tid(winner)] ?? 0) - price;
  const rosterCounts = { ...room.roster_counts };
  rosterCounts[tid(winner)] = (rosterCounts[tid(winner)] ?? 0) + 1;

  let next: AuctionRoom = {
    ...room,
    budgets,
    roster_counts: rosterCounts,
    picks: [...room.picks, pick],
    current: null,
    available_player_ids: room.available_player_ids.filter(
      (id) => id !== lot.player_id,
    ),
  };

  if (allRostersFull(next)) {
    next = { ...next, phase: "complete", nominator_idx: next.nominator_idx };
    return bump(next, now);
  }

  const prevIdx = next.nominator_idx;
  const nominatorIdx = nextNominatorIdx(next, prevIdx);
  let auctionRound = next.auction_round;
  // Offline runner bumps round when nominator wraps past 0.
  if (nominatorIdx <= prevIdx) {
    auctionRound += 1;
  }

  next = {
    ...next,
    phase: "nominate",
    nominator_idx: nominatorIdx,
    auction_round: auctionRound,
  };
  return bump(next, now);
}

/** Apply expired bid timers. Safe to call on every GET/POST. */
export function tickAuctionRoom(
  room: AuctionRoom,
  now: Date = new Date(),
): AuctionRoom {
  if (room.phase !== "bidding" || !room.current) return room;
  const ends = new Date(room.current.bid_ends_at).getTime();
  const hard = new Date(room.current.hard_ends_at).getTime();
  const t = now.getTime();
  if (t < ends && t < hard) return room;
  if (room.current.high_bidder_team_id == null) {
    // No bid — return player to pool and skip nominator.
    const lot = room.current;
    const next = {
      ...room,
      current: null,
      phase: "nominate" as const,
      nominator_idx: nextNominatorIdx(room, room.nominator_idx),
      available_player_ids: [lot.player_id, ...room.available_player_ids],
    };
    return bump(next, now);
  }
  return sellLot(room, now);
}

export function startAuctionRoom(
  room: AuctionRoom,
  now: Date = new Date(),
): AuctionRoom {
  room = tickAuctionRoom(room, now);
  if (room.phase !== "lobby") {
    throw new Error(`cannot start from phase ${room.phase}`);
  }
  return bump({ ...room, phase: "nominate", nominator_idx: 0 }, now);
}

export function nominatePlayer(
  room: AuctionRoom,
  teamId: number,
  playerId: number,
  now: Date = new Date(),
): AuctionRoom {
  room = tickAuctionRoom(room, now);
  if (room.phase !== "nominate") {
    throw new Error(`cannot nominate from phase ${room.phase}`);
  }
  const nominator = room.team_ids[room.nominator_idx];
  if (nominator !== teamId) {
    throw new Error("only the nominating team can nominate");
  }
  if ((room.roster_counts[tid(teamId)] ?? 0) >= room.roster_slots) {
    throw new Error("nominating team roster is full");
  }
  if (!room.available_player_ids.includes(playerId)) {
    throw new Error("player is not available");
  }
  const name = room.player_names[tid(playerId)] ?? `Player ${playerId}`;
  const opened = now.getTime();
  const lot: AuctionLot = {
    player_id: playerId,
    player_name: name,
    nominating_team_id: teamId,
    high_bid: 0,
    high_bidder_team_id: null,
    opened_at: iso(now),
    bid_ends_at: new Date(opened + room.bid_window_ms).toISOString(),
    hard_ends_at: new Date(opened + room.bid_hard_cap_ms).toISOString(),
    passed_team_ids: [],
  };
  return bump(
    {
      ...room,
      phase: "bidding",
      current: lot,
      available_player_ids: room.available_player_ids.filter(
        (id) => id !== playerId,
      ),
    },
    now,
  );
}

export function placeBid(
  room: AuctionRoom,
  teamId: number,
  amount: number,
  now: Date = new Date(),
): AuctionRoom {
  room = tickAuctionRoom(room, now);
  if (room.phase !== "bidding" || !room.current) {
    throw new Error("no active lot to bid on");
  }
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error("bid must be an integer ≥ 1");
  }
  if ((room.roster_counts[tid(teamId)] ?? 0) >= room.roster_slots) {
    throw new Error("team roster is full");
  }
  const maxBid = maxBidForTeam(room, teamId);
  if (amount > maxBid) {
    throw new Error(`bid exceeds max spendable ($${maxBid})`);
  }
  const minNext =
    room.current.high_bidder_team_id == null
      ? 1
      : room.current.high_bid + 1;
  if (amount < minNext) {
    throw new Error(`bid must be at least $${minNext}`);
  }
  if (room.current.passed_team_ids.includes(teamId)) {
    throw new Error("team already passed on this lot");
  }

  const opened = new Date(room.current.opened_at).getTime();
  const hardEnds = opened + room.bid_hard_cap_ms;
  const soft = Math.min(now.getTime() + room.bid_window_ms, hardEnds);
  const lot: AuctionLot = {
    ...room.current,
    high_bid: amount,
    high_bidder_team_id: teamId,
    bid_ends_at: new Date(soft).toISOString(),
    // New high bid clears passes (re-open for others).
    passed_team_ids: [],
  };
  return bump({ ...room, current: lot }, now);
}

export function passBid(
  room: AuctionRoom,
  teamId: number,
  now: Date = new Date(),
): AuctionRoom {
  room = tickAuctionRoom(room, now);
  if (room.phase !== "bidding" || !room.current) {
    throw new Error("no active lot to pass");
  }
  if (room.current.high_bidder_team_id === teamId) {
    throw new Error("high bidder cannot pass");
  }
  if ((room.roster_counts[tid(teamId)] ?? 0) >= room.roster_slots) {
    throw new Error("team roster is full");
  }
  if (room.current.passed_team_ids.includes(teamId)) {
    return room;
  }
  const passed = [...room.current.passed_team_ids, teamId];
  const lot = { ...room.current, passed_team_ids: passed };
  const next: AuctionRoom = { ...room, current: lot };

  // Sell early when everyone else eligible has passed and there is a bid.
  if (lot.high_bidder_team_id != null) {
    const eligible = room.team_ids.filter((id) => {
      if (id === lot.high_bidder_team_id) return false;
      return (room.roster_counts[tid(id)] ?? 0) < room.roster_slots;
    });
    if (eligible.every((id) => passed.includes(id))) {
      return sellLot(next, now);
    }
  }

  return bump(next, now);
}

export function markFinalized(
  room: AuctionRoom,
  now: Date = new Date(),
): AuctionRoom {
  room = tickAuctionRoom(room, now);
  if (room.phase !== "complete") {
    throw new Error(`cannot finalize from phase ${room.phase}`);
  }
  return bump({ ...room, phase: "finalized" }, now);
}

export function currentNominator(room: AuctionRoom): number | null {
  if (room.phase !== "nominate" && room.phase !== "bidding") return null;
  return room.team_ids[room.nominator_idx] ?? null;
}

export function availablePlayers(
  room: AuctionRoom,
): Array<{ id: number; name: string }> {
  return room.available_player_ids.map((id) => ({
    id,
    name: room.player_names[tid(id)] ?? `Player ${id}`,
  }));
}
