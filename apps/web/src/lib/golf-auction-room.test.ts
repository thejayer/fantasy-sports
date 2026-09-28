import { describe, expect, it } from "vitest";

import {
  createAuctionRoom,
  nominatePlayer,
  passBid,
  placeBid,
  startAuctionRoom,
  tickAuctionRoom,
} from "./golf-auction-room";

function baseRoom(now = new Date("2026-07-29T12:00:00.000Z")) {
  return createAuctionRoom({
    league_id: "golf-live",
    season: 2026,
    team_ids: [1, 2, 3, 4],
    team_names: {
      "1": "T1",
      "2": "T2",
      "3": "T3",
      "4": "T4",
    },
    budget: 100,
    bench: 2,
    now,
    bid_window_ms: 5_000,
    bid_hard_cap_ms: 20_000,
  });
}

describe("golf auction room FSM", () => {
  it("creates a lobby with budgets and OWGR pool", () => {
    const room = baseRoom();
    expect(room.phase).toBe("lobby");
    expect(room.budgets["1"]).toBe(100);
    expect(room.available_player_ids[0]).toBe(1);
    expect(room.player_names["1"]).toBe("Scottie Scheffler");
  });

  it("runs nominate → bid → pass-all → sold", () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    let room = startAuctionRoom(baseRoom(now), now);
    expect(room.phase).toBe("nominate");
    room = nominatePlayer(room, 1, 1, now);
    expect(room.phase).toBe("bidding");
    expect(room.current?.player_name).toBe("Scottie Scheffler");

    room = placeBid(room, 2, 5, now);
    expect(room.current?.high_bid).toBe(5);
    expect(room.current?.high_bidder_team_id).toBe(2);

    room = passBid(room, 1, now);
    room = passBid(room, 3, now);
    room = passBid(room, 4, now);
    expect(room.phase).toBe("nominate");
    expect(room.picks).toHaveLength(1);
    expect(room.picks[0]?.team_id).toBe(2);
    expect(room.picks[0]?.bid_amount).toBe(5);
    expect(room.picks[0]?.nominating_team_id).toBe(1);
    expect(room.budgets["2"]).toBe(95);
    expect(room.roster_counts["2"]).toBe(1);
  });

  it("sells on timer expiry when there is a high bidder", () => {
    let now = new Date("2026-07-29T12:00:00.000Z");
    let room = startAuctionRoom(baseRoom(now), now);
    room = nominatePlayer(room, 1, 1, now);
    room = placeBid(room, 1, 3, now);
    now = new Date(now.getTime() + 6_000);
    room = tickAuctionRoom(room, now);
    expect(room.phase).toBe("nominate");
    expect(room.picks[0]?.bid_amount).toBe(3);
    expect(room.picks[0]?.team_id).toBe(1);
  });

  it("rejects bids above reserve-$1 max", () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    let room = startAuctionRoom(baseRoom(now), now);
    room = nominatePlayer(room, 1, 1, now);
    // roster_slots = 7; open=7 → max = 100 - 6 = 94
    expect(() => placeBid(room, 2, 95, now)).toThrow(/max spendable/i);
    room = placeBid(room, 2, 94, now);
    expect(room.current?.high_bid).toBe(94);
  });
});
