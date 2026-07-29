import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import type {
  GolfScoreboardEvent,
  GolfScoreboardTeamWeek,
  LeagueSnapshot,
} from "@/lib/data";

function formatPoints(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function resolveEvent(
  league: LeagueSnapshot,
  eventId?: string,
): GolfScoreboardEvent | null {
  const events = league.scoreboard?.events ?? [];
  if (!events.length) return null;
  if (eventId) {
    const hit = events.find((e) => e.event_id === eventId);
    if (hit) return hit;
  }
  const current = league.scoreboard?.current_event_id;
  return (
    events.find((e) => e.event_id === current) ?? events[0] ?? null
  );
}

function playerLabel(
  league: LeagueSnapshot,
  playerId: number,
): string {
  return (
    league.players.find((p) => p.id === playerId)?.name ?? `#${playerId}`
  );
}

function RoundSlots({
  league,
  week,
}: {
  league: LeagueSnapshot;
  week: GolfScoreboardTeamWeek;
}) {
  const rounds = (["1", "2", "3", "4"] as const)
    .map((key) => week.by_round[key])
    .filter(Boolean);
  if (!rounds.length) return null;
  return (
    <div style={{ marginTop: "0.5rem" }}>
      {rounds.map((rnd) => (
        <details key={rnd!.round} style={{ marginBottom: "0.35rem" }}>
          <summary>
            {rnd!.label} · {formatPoints(rnd!.points)} pts ·{" "}
            {rnd!.slots.length} slots
          </summary>
          <div className="table-wrap" style={{ marginTop: "0.35rem" }}>
            <table className="table-cards">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>To par</th>
                  <th>Pts</th>
                </tr>
              </thead>
              <tbody>
                {rnd!.slots.map((slot) => (
                  <tr key={`${rnd!.round}-${slot.starter_id}-${slot.player_id}`}>
                    <td data-label="Player">
                      {playerLabel(league, slot.player_id)}
                    </td>
                    <td data-label="Source">{slot.source}</td>
                    <td data-label="Status">{slot.status}</td>
                    <td data-label="To par">
                      {slot.to_par == null ? "—" : formatPoints(slot.to_par)}
                    </td>
                    <td data-label="Pts">{formatPoints(slot.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}

export function GolfScoreboardPanel({
  league,
  eventId,
}: {
  league: LeagueSnapshot;
  eventId?: string;
}) {
  const events = league.scoreboard?.events ?? [];
  const active = resolveEvent(league, eventId);

  if (!events.length || !active) {
    return (
      <EmptyState title="No scored events yet">
        End-of-day counting uses fixture round files. Regenerate golf fixtures
        or create a new golf league.
      </EmptyState>
    );
  }

  const nameById = new Map(
    league.teams.map((t) => [t.team_id, t.name] as const),
  );
  const ranked = Object.entries(active.teams)
    .map(([teamId, week]) => ({
      teamId: Number(teamId),
      name: nameById.get(Number(teamId)) ?? `Team ${teamId}`,
      week,
    }))
    .sort(
      (a, b) =>
        b.week.week_total - a.week.week_total ||
        b.week.captain_week - a.week.captain_week,
    );

  return (
    <div className="golf-scoreboard-panel" style={{ marginTop: "0.75rem" }}>
      <p className="lede">
        Counting scoreboard — best 4 of 5 Thu/Fri, all 5 Sat/Sun, missed-cut
        alts on the weekend, then event multiplier. Expand a team for
        per-player daily slots. Fixture rounds only (no live tour feed).
      </p>

      <div className="tabs" style={{ marginTop: "0.5rem" }}>
        {events.map((event) => (
          <Link
            key={event.event_id}
            href={`/leagues/${league.league_id}?season=${league.season}&tab=scoreboard&event=${event.event_id}`}
            className={`tab${event.event_id === active.event_id ? " active" : ""}`}
          >
            W{event.week ?? "?"} · {event.name ?? event.event_id}
          </Link>
        ))}
      </div>

      <p className="league-meta" style={{ marginTop: "0.75rem" }}>
        {active.name} · {active.multiplier_tier} ×
        {formatPoints(active.multiplier)} · scored{" "}
        {active.scored_at
          .replace("T", " ")
          .replace(/\.\d{3}Z$/, " UTC")
          .replace(/\+00:00$/, " UTC")}
      </p>

      {active.pairings.length ? (
        <div className="panel" style={{ padding: "1rem", marginTop: "0.75rem" }}>
          <h3 style={{ marginTop: 0 }}>Head-to-head</h3>
          <div className="table-wrap">
            <table className="table-cards">
              <thead>
                <tr>
                  <th>Matchup</th>
                  <th>Home</th>
                  <th>Away</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {active.pairings.map((pair) => (
                  <tr key={`${pair.home_team_id}-${pair.away_team_id}`}>
                    <td data-label="Matchup">
                      {pair.home_name ?? pair.home_team_id} vs{" "}
                      {pair.away_name ?? pair.away_team_id}
                    </td>
                    <td data-label="Home">{formatPoints(pair.home_total)}</td>
                    <td data-label="Away">{formatPoints(pair.away_total)}</td>
                    <td data-label="Result">{pair.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="panel" style={{ padding: "1rem", marginTop: "0.75rem" }}>
        <h3 style={{ marginTop: 0 }}>Week totals</h3>
        <div className="table-wrap">
          <table className="table-cards">
            <thead>
              <tr>
                <th>Team</th>
                <th>Raw</th>
                <th>Total</th>
                <th>Captain</th>
                <th>Thu</th>
                <th>Fri</th>
                <th>Sat</th>
                <th>Sun</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((row) => (
                <tr key={row.teamId}>
                  <td data-label="Team">
                    <details>
                      <summary>
                        <strong>{row.name}</strong>
                      </summary>
                      <RoundSlots league={league} week={row.week} />
                    </details>
                  </td>
                  <td data-label="Raw">{formatPoints(row.week.week_raw)}</td>
                  <td data-label="Total">
                    <strong>{formatPoints(row.week.week_total)}</strong>
                  </td>
                  <td data-label="Captain">
                    {formatPoints(row.week.captain_week)}
                  </td>
                  {(["1", "2", "3", "4"] as const).map((rnd) => (
                    <td
                      key={rnd}
                      data-label={row.week.by_round[rnd]?.label ?? rnd}
                    >
                      {formatPoints(row.week.by_round[rnd]?.points ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
