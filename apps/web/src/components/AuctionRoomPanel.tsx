"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import type { LeagueSnapshot } from "@/lib/data";
import {
  availablePlayers,
  currentNominator,
  maxBidForTeam,
  type AuctionRoom,
} from "@/lib/golf-auction-room";
import { draftBudgetRows } from "@/lib/golf-draft";
import { DEFAULT_GOLF_SETTINGS, parseGolfSettings } from "@/lib/golf";
import type { GolfActingScope } from "@/lib/hub-members";

async function fetchRoom(
  leagueId: string,
  season: number,
): Promise<AuctionRoom | null> {
  const res = await fetch(
    `/api/golf/leagues/${leagueId}/auction?season=${season}`,
    { cache: "no-store" },
  );
  if (res.status === 404) return null;
  const payload = (await res.json()) as { room?: AuctionRoom; error?: string };
  if (!res.ok) throw new Error(payload.error || "failed to load room");
  return payload.room ?? null;
}

export function AuctionRoomPanel({
  league,
  teamId,
  actingScope,
}: {
  league: LeagueSnapshot;
  teamId?: number;
  actingScope?: GolfActingScope;
}) {
  const golf = parseGolfSettings(league.settings) ?? DEFAULT_GOLF_SETTINGS;
  const allowedTeamIds =
    actingScope?.allowedTeamIds ?? league.teams.map((t) => t.team_id);
  const canPickActingTeam = allowedTeamIds.length > 1;
  const canControlAuction = actingScope?.canControlAuction ?? true;
  const canFinalizeAuction = actingScope?.canFinalizeAuction ?? true;
  const [room, setRoom] = useState<AuctionRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const defaultTeam =
    (teamId != null && allowedTeamIds.includes(teamId)
      ? teamId
      : undefined) ??
    allowedTeamIds[0] ??
    league.teams[0]?.team_id ??
    1;
  const [actingTeamLocal, setActingTeamLocal] = useState<number>(defaultTeam);
  const effectiveTeam = canPickActingTeam
    ? (teamId != null && allowedTeamIds.includes(teamId)
        ? teamId
        : actingTeamLocal)
    : (allowedTeamIds[0] ?? defaultTeam);
  const actingTeams = league.teams.filter((t) =>
    allowedTeamIds.includes(t.team_id),
  );
  const [bidAmount, setBidAmount] = useState(1);
  const [nominee, setNominee] = useState<number | "">("");
  const [nowTick, setNowTick] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const next = await fetchRoom(league.league_id, league.season);
      setRoom(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load room");
    }
  }, [league.league_id, league.season]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchRoom(league.league_id, league.season);
        if (!cancelled) {
          setRoom(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "failed to load room");
        }
      }
    })();
    const poll = setInterval(() => {
      void refresh();
    }, 1000);
    const clock = setInterval(() => setNowTick(Date.now()), 250);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [league.league_id, league.season, refresh]);

  async function createRoom() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/golf/leagues/${league.league_id}/auction`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          season: league.season,
          // Faster clocks for local demos / e2e.
          bid_window_ms: 8_000,
          bid_hard_cap_ms: 30_000,
        }),
      });
      const payload = (await res.json()) as { room?: AuctionRoom; error?: string };
      if (!res.ok) throw new Error(payload.error || "create failed");
      setRoom(payload.room ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/golf/leagues/${league.league_id}/auction/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            season: league.season,
            revision: room.revision,
            team_id: effectiveTeam,
            ...extra,
          }),
        },
      );
      const payload = (await res.json()) as {
        room?: AuctionRoom;
        error?: string;
      };
      if (payload.room) setRoom(payload.room);
      if (!res.ok) throw new Error(payload.error || "action failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "action failed");
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  const nominator = room ? currentNominator(room) : null;
  const pool = useMemo(
    () => (room ? availablePlayers(room).slice(0, 40) : []),
    [room],
  );
  const maxBid = room ? maxBidForTeam(room, effectiveTeam) : 0;
  const budgetRows = room
    ? draftBudgetRows(
        league.teams,
        room.picks,
        room.budget,
      )
    : [];

  const secondsLeft = room?.current
    ? Math.max(
        0,
        Math.ceil(
          (new Date(room.current.bid_ends_at).getTime() - nowTick) / 1000,
        ),
      )
    : null;

  if (golf.draft.style !== "auction") {
    return (
      <EmptyState title="Live auction is for auction leagues">
        This league uses a {golf.draft.style} draft. Create an auction league
        (or open Draft for the offline board).
      </EmptyState>
    );
  }

  if (!room) {
    return (
      <div className="panel" style={{ padding: "1rem", marginTop: "0.75rem" }}>
        <h3 style={{ marginTop: 0 }}>Live nomination room</h3>
        <p className="lede">
          File-backed multiplayer auction — nominate, bid, and pass with a
          short timer. Polls every second. Not a websocket room.
        </p>
        {actingScope?.hint ? (
          <p className="league-meta">{actingScope.hint}</p>
        ) : null}
        {league.draft?.length ? (
          <p className="league-meta">
            This season already has a completed draft (
            <Link
              href={`/leagues/${league.league_id}?season=${league.season}&tab=draft`}
            >
              view board
            </Link>
            ).
          </p>
        ) : (
          <button
            className="button"
            type="button"
            disabled={busy || !canControlAuction}
            onClick={() => void createRoom()}
          >
            {busy ? "Opening…" : "Open auction room"}
          </button>
        )}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="auction-room-panel" style={{ marginTop: "0.75rem" }}>
      <p className="lede">
        Live OWGR auction · phase <strong>{room.phase}</strong> · rev{" "}
        {room.revision} · acting as{" "}
        {canPickActingTeam ? (
          <select
            value={effectiveTeam}
            onChange={(e) => setActingTeamLocal(Number(e.target.value))}
            aria-label="Acting team"
          >
            {actingTeams.map((t) => (
              <option key={t.team_id} value={t.team_id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          <strong aria-label="Acting team">
            {actingTeams[0]?.name ?? `team ${effectiveTeam}`}
          </strong>
        )}
        . Max bid ${maxBid}.
      </p>
      {actingScope?.hint && !canPickActingTeam ? (
        <p className="league-meta">{actingScope.hint}</p>
      ) : null}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {room.phase === "lobby" ? (
        <div className="panel" style={{ padding: "1rem" }}>
          <p className="league-meta" style={{ marginTop: 0 }}>
            Lobby — {room.team_ids.length} teams · ${room.budget} budget ·{" "}
            {room.roster_slots} roster slots.
          </p>
          <button
            className="button"
            type="button"
            disabled={busy || !canControlAuction}
            onClick={() => void runAction("start")}
          >
            Start auction
          </button>
        </div>
      ) : null}

      {room.phase === "nominate" ? (
        <div className="panel" style={{ padding: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>
            Nominate —{" "}
            {nominator != null
              ? room.team_names[String(nominator)]
              : "—"}
            &apos;s turn
          </h3>
          {effectiveTeam === nominator ? (
            <div className="form-grid">
              <label>
                Player
                <select
                  value={nominee}
                  onChange={(e) =>
                    setNominee(e.target.value ? Number(e.target.value) : "")
                  }
                >
                  <option value="">Select…</option>
                  {pool.map((p) => (
                    <option key={p.id} value={p.id}>
                      #{p.id} {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button"
                type="button"
                disabled={busy || nominee === ""}
                onClick={() =>
                  void runAction("nominate", { player_id: nominee })
                }
              >
                Nominate
              </button>
            </div>
          ) : (
            <p className="league-meta">Waiting for nominator…</p>
          )}
        </div>
      ) : null}

      {room.phase === "bidding" && room.current ? (
        <div className="panel" style={{ padding: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>
            Bidding · {room.current.player_name}
          </h3>
          <p className="league-meta">
            Nominated by {room.team_names[String(room.current.nominating_team_id)]}{" "}
            · high bid{" "}
            <strong>
              ${room.current.high_bid}
              {room.current.high_bidder_team_id != null
                ? ` (${room.team_names[String(room.current.high_bidder_team_id)]})`
                : ""}
            </strong>{" "}
            · timer {secondsLeft}s
          </p>
          <div className="form-grid">
            <label>
              Your bid
              <input
                type="number"
                min={1}
                max={maxBid}
                value={bidAmount}
                onChange={(e) => setBidAmount(Number(e.target.value))}
              />
            </label>
            <button
              className="button"
              type="button"
              disabled={busy || maxBid < 1}
              onClick={() => void runAction("bid", { amount: bidAmount })}
            >
              Bid ${bidAmount}
            </button>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() =>
                void runAction("bid", {
                  amount: Math.min(
                    maxBid,
                    Math.max(
                      1,
                      (room.current?.high_bid ?? 0) + 1,
                    ),
                  ),
                })
              }
            >
              +$1
            </button>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => void runAction("pass")}
            >
              Pass
            </button>
          </div>
        </div>
      ) : null}

      {room.phase === "complete" ? (
        <div className="panel" style={{ padding: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>Auction complete</h3>
          <p className="league-meta">
            {room.picks.length} picks sold. Finalize writes draft.json, rosters,
            lineups, and scoreboard.
          </p>
          <button
            className="button"
            type="button"
            disabled={busy || !canFinalizeAuction}
            onClick={() => void runAction("finalize")}
          >
            Finalize draft
          </button>
          {!canFinalizeAuction ? (
            <p className="league-meta">Only an admin can finalize.</p>
          ) : null}
        </div>
      ) : null}

      {room.phase === "finalized" ? (
        <div className="panel" style={{ padding: "1rem" }}>
          <p className="lede" style={{ marginTop: 0 }}>
            Finalized.{" "}
            <Link
              href={`/leagues/${league.league_id}?season=${league.season}&tab=draft`}
            >
              Open draft board
            </Link>
            .
          </p>
        </div>
      ) : null}

      {budgetRows.length ? (
        <div className="panel table-scroll" style={{ marginTop: "0.75rem" }}>
          <h3 style={{ margin: "0.75rem 1rem 0" }}>Budgets</h3>
          <table className="table-cards">
            <thead>
              <tr>
                <th>Team</th>
                <th>Picks</th>
                <th className="numeric">Spent</th>
                <th className="numeric">Left</th>
              </tr>
            </thead>
            <tbody>
              {budgetRows.map((row) => (
                <tr key={row.team_id}>
                  <td data-label="Team">{row.name}</td>
                  <td data-label="Picks">{row.picks}</td>
                  <td data-label="Spent" className="numeric">
                    ${row.spent}
                  </td>
                  <td data-label="Left" className="numeric">
                    ${row.remaining}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {room.picks.length ? (
        <div className="panel table-scroll" style={{ marginTop: "0.75rem" }}>
          <h3 style={{ margin: "0.75rem 1rem 0" }}>Sold</h3>
          <table className="table-cards">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Team</th>
                <th className="numeric">Bid</th>
              </tr>
            </thead>
            <tbody>
              {room.picks.map((pick, i) => (
                <tr key={`${pick.player_id}-${i}`}>
                  <td data-label="#">{i + 1}</td>
                  <td data-label="Player">{pick.player_name}</td>
                  <td data-label="Team">
                    {room.team_names[String(pick.team_id)] ?? pick.team_id}
                  </td>
                  <td data-label="Bid" className="numeric">
                    ${pick.bid_amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
