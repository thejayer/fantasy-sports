"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import type { LeagueSnapshot, Team } from "@/lib/data";
import {
  DEFAULT_GOLF_SETTINGS,
  parseGolfSettings,
} from "@/lib/golf";
import {
  lineupClock,
  playerIsLocked,
  type GolfEventMeta,
  type GolfWeekLineup,
} from "@/lib/golf-lineup";
import type { GolfActingScope } from "@/lib/hub-members";

/** Deterministic UTC label — avoids SSR/client `toLocaleString` mismatch. */
function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function resolveEventId(
  league: LeagueSnapshot,
  eventId?: string,
): string | null {
  const events = league.lineups?.events ?? [];
  if (!events.length) return null;
  if (eventId && events.some((e) => e.event_id === eventId)) return eventId;
  return (
    league.lineups?.current_event_id ??
    events.find((e) => e.week === league.current_week)?.event_id ??
    events[0]?.event_id ??
    null
  );
}

function LineupForm({
  league,
  event,
  team,
  stored,
  showAlt1,
  showAlt2,
  now,
  canEdit,
  onSaved,
  onError,
}: {
  league: LeagueSnapshot;
  event: GolfEventMeta;
  team: Team;
  stored: GolfWeekLineup | null;
  showAlt1: boolean;
  showAlt2: boolean;
  now: Date;
  canEdit: boolean;
  onSaved: (savedAt: string) => void;
  onError: (message: string | null) => void;
}) {
  const [starters, setStarters] = useState<number[]>(
    () => stored?.starters ?? [],
  );
  const [captain, setCaptain] = useState<number | "">(
    () => stored?.captain ?? "",
  );
  const [alt1, setAlt1] = useState<number | "">(() => stored?.alt1 ?? "");
  const [alt2, setAlt2] = useState<number | "">(() => stored?.alt2 ?? "");
  const [pending, setPending] = useState(false);

  const roster = team.roster ?? [];
  const byId = new Map(
    roster
      .map((p) => [Number(p.id), p] as const)
      .filter(([id]) => !Number.isNaN(id)),
  );

  function toggleStarter(playerId: number) {
    if (playerIsLocked(playerId, event.tee_times, now)) return;
    setStarters((prev) => {
      if (prev.includes(playerId)) {
        const next = prev.filter((id) => id !== playerId);
        if (captain === playerId) setCaptain(next[0] ?? "");
        return next;
      }
      if (prev.length >= 5) return prev;
      return [...prev, playerId];
    });
  }

  async function onSave() {
    if (pending || !canEdit) return;
    onError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/golf/leagues/${league.league_id}/lineups`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          season: league.season,
          team_id: team.team_id,
          event_id: event.event_id,
          starters,
          captain: captain === "" ? null : captain,
          alt1: alt1 === "" ? null : alt1,
          alt2: alt2 === "" ? null : alt2,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        lineup?: { saved_at?: string };
      };
      if (!res.ok) {
        onError(payload.error || `Save failed (${res.status})`);
        return;
      }
      onSaved(payload.lineup?.saved_at ?? new Date().toISOString());
    } catch {
      onError("Save failed (network)");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel" style={{ padding: "1rem", marginTop: "0.75rem" }}>
      <h3 style={{ marginTop: 0 }}>Roster</h3>
      <ul className="lineup-roster">
        {roster.map((player) => {
          const id = Number(player.id);
          const locked = playerIsLocked(id, event.tee_times, now);
          const selected = starters.includes(id);
          const tee = event.tee_times?.[String(id)];
          return (
            <li key={`${id}-${player.slot}`}>
              <label className={locked ? "is-locked" : ""}>
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={
                    !canEdit ||
                    locked ||
                    (!selected && starters.length >= 5)
                  }
                  onChange={() => toggleStarter(id)}
                />
                <span>
                  <strong>{player.name}</strong>
                  <span className="league-meta">
                    {" "}
                    · {player.slot ?? "—"}
                    {tee ? ` · tee ${formatUtc(tee)}` : ""}
                    {locked ? " · LOCKED" : ""}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="form-grid" style={{ marginTop: "1rem" }}>
        <label>
          Captain
          <select
            value={captain}
            disabled={!canEdit}
            onChange={(e) =>
              setCaptain(e.target.value ? Number(e.target.value) : "")
            }
          >
            <option value="">Select…</option>
            {starters.map((id) => (
              <option key={id} value={id}>
                {byId.get(id)?.name ?? id}
              </option>
            ))}
          </select>
        </label>
        {showAlt1 ? (
          <label>
            Alt1
            <select
              value={alt1}
              onChange={(e) =>
                setAlt1(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">None</option>
              {roster
                .map((p) => Number(p.id))
                .filter((id) => !starters.includes(id))
                .map((id) => (
                  <option
                    key={id}
                    value={id}
                    disabled={playerIsLocked(id, event.tee_times, now)}
                  >
                    {byId.get(id)?.name ?? id}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        {showAlt2 ? (
          <label>
            Alt2
            <select
              value={alt2}
              onChange={(e) =>
                setAlt2(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">None</option>
              {roster
                .map((p) => Number(p.id))
                .filter((id) => !starters.includes(id) && id !== alt1)
                .map((id) => (
                  <option
                    key={id}
                    value={id}
                    disabled={playerIsLocked(id, event.tee_times, now)}
                  >
                    {byId.get(id)?.name ?? id}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
      </div>

      <button
        className="button"
        type="button"
        disabled={
          !canEdit || pending || starters.length !== 5 || captain === ""
        }
        onClick={onSave}
        style={{ marginTop: "1rem" }}
      >
        {pending ? "Saving…" : "Save lineup"}
      </button>
      {!canEdit ? (
        <p className="league-meta" role="status">
          Read-only — this is not your linked franchise.
        </p>
      ) : null}
    </div>
  );
}

function LineupEditor({
  league,
  event,
  team,
  stored,
  showAlt1,
  showAlt2,
  now,
  canEdit,
}: {
  league: LeagueSnapshot;
  event: GolfEventMeta;
  team: Team;
  stored: GolfWeekLineup | null;
  showAlt1: boolean;
  showAlt2: boolean;
  now: Date;
  canEdit: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAtOverride, setSavedAtOverride] = useState<string | null>(null);
  const savedAt = savedAtOverride ?? stored?.saved_at ?? null;
  const formKey = stored?.saved_at ?? "none";

  return (
    <>
      <p className="league-meta" style={{ marginTop: "0.75rem" }}>
        {event.name} · {event.multiplier_tier} · starts{" "}
        {formatUtc(event.starts_at)} · team {team.name}
        {savedAt ? ` · saved ${formatUtc(savedAt)}` : ""}
      </p>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="league-meta" role="status">
          {message}
        </p>
      ) : null}

      <LineupForm
        key={formKey}
        league={league}
        event={event}
        team={team}
        stored={stored}
        showAlt1={showAlt1}
        showAlt2={showAlt2}
        now={now}
        canEdit={canEdit}
        onSaved={(nextSavedAt) => {
          setError(null);
          setMessage("Lineup saved.");
          setSavedAtOverride(nextSavedAt);
        }}
        onError={(value) => {
          setMessage(null);
          setError(value);
        }}
      />
    </>
  );
}

export function GolfLineupPanel({
  league,
  eventId,
  teamId,
  actingScope,
}: {
  league: LeagueSnapshot;
  eventId?: string;
  teamId?: number;
  actingScope?: GolfActingScope;
}) {
  const events = league.lineups?.events ?? [];
  const activeEventId = resolveEventId(league, eventId);
  const activeEvent = events.find((e) => e.event_id === activeEventId) ?? null;
  const allowedTeamIds =
    actingScope?.allowedTeamIds ?? league.teams.map((t) => t.team_id);
  const preferredTeamId =
    teamId != null && allowedTeamIds.includes(teamId)
      ? teamId
      : allowedTeamIds[0];
  const activeTeamId = preferredTeamId ?? league.teams[0]?.team_id;
  const team = league.teams.find((t) => t.team_id === activeTeamId) ?? null;
  const canEdit =
    activeTeamId != null && allowedTeamIds.includes(activeTeamId);
  const golf = parseGolfSettings(league.settings) ?? DEFAULT_GOLF_SETTINGS;
  const showAlt1 =
    golf.missed_cut.mode === "alt1" || golf.missed_cut.mode === "alt1_2";
  const showAlt2 = golf.missed_cut.mode === "alt1_2";

  const stored: GolfWeekLineup | null =
    activeEventId && activeTeamId != null
      ? (league.lineups?.teams[String(activeTeamId)]?.[activeEventId] ?? null)
      : null;

  const now = useMemo(() => lineupClock(league.synced_at), [league.synced_at]);

  if (!events.length || !activeEvent || !team) {
    return (
      <EmptyState title="No lineup events yet">
        Fixture FedEx events land with create/seed. Regenerate golf fixtures or
        create a new golf league.
      </EmptyState>
    );
  }

  return (
    <div className="golf-lineup-panel" style={{ marginTop: "0.75rem" }}>
      <p className="lede">
        Set five starters, a captain (tiebreaker only), and missed-cut alts.
        Players lock at their fixture R1 tee time (UTC) — fail closed.
      </p>
      {actingScope?.hint ? (
        <p className="league-meta">{actingScope.hint}</p>
      ) : null}

      <div className="tabs" style={{ marginTop: "0.5rem" }}>
        {events.map((event) => (
          <Link
            key={event.event_id}
            href={`/leagues/${league.league_id}?season=${league.season}&tab=lineup&event=${event.event_id}&team=${activeTeamId}`}
            className={`tab${event.event_id === activeEventId ? " active" : ""}`}
          >
            W{event.week} · {event.name}
          </Link>
        ))}
      </div>

      <div className="tabs" style={{ marginTop: "0.5rem" }}>
        {league.teams.map((item) => (
          <Link
            key={item.team_id}
            href={`/leagues/${league.league_id}?season=${league.season}&tab=lineup&event=${activeEventId}&team=${item.team_id}`}
            className={`tab${item.team_id === activeTeamId ? " active" : ""}`}
          >
            {item.abbrev || item.name}
          </Link>
        ))}
      </div>

      {/* Remount clears save status when switching event/team. */}
      <LineupEditor
        key={`${activeEventId}-${activeTeamId}`}
        league={league}
        event={activeEvent}
        team={team}
        stored={stored}
        showAlt1={showAlt1}
        showAlt2={showAlt2}
        now={now}
        canEdit={canEdit}
      />
    </div>
  );
}
