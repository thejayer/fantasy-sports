/**
 * Golf week scoreboard (roadmap 6.4d / 7.11 / 8.3).
 *
 * Per-player round slots stay off this tab (HTML budget). Week totals +
 * projected totals when ``through_round`` < 4.
 */

import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import type {
  GolfScoreboardEvent,
  LeagueSnapshot,
} from "@/lib/data";

function formatPoints(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

const ROUND_LABELS: Record<number, string> = {
  1: "Thu",
  2: "Fri",
  3: "Sat",
  4: "Sun",
};

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

  const through = active.through_round ?? 4;
  const inProgress = (active.status ?? "final") === "in_progress" || through < 4;
  const nameById = new Map(
    league.teams.map((t) => [t.team_id, t.name] as const),
  );
  const ranked = Object.entries(active.teams)
    .map(([teamId, week]) => ({
      teamId: Number(teamId),
      name: nameById.get(Number(teamId)) ?? `Team ${teamId}`,
      week,
      sortKey: inProgress
        ? (week.week_projected ?? week.week_total)
        : week.week_total,
    }))
    .sort(
      (a, b) =>
        b.sortKey - a.sortKey ||
        b.week.captain_week - a.week.captain_week,
    );

  return (
    <div className="golf-scoreboard-panel" style={{ marginTop: "0.75rem" }}>
      <p className="lede">
        Counting scoreboard — best 4 of 5 Thu/Fri, all 5 Sat/Sun, missed-cut
        alts on the weekend, then event multiplier. Open a team for per-player
        round slots. Fixture rounds only (no live tour feed).
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
        {formatPoints(active.multiplier)} ·{" "}
        {inProgress
          ? `Through ${ROUND_LABELS[through] ?? through} · projected week`
          : "Final"}{" "}
        · scored{" "}
        {active.scored_at
          .replace("T", " ")
          .replace(/\.\d{3}Z$/, " UTC")
          .replace(/\+00:00$/, " UTC")}
      </p>

      {active.pairings.length ? (
        <div className="panel" style={{ padding: "1rem", marginTop: "0.75rem" }}>
          <h3 style={{ marginTop: 0 }}>
            Head-to-head{inProgress ? " (projected)" : ""}
          </h3>
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
        <h3 style={{ marginTop: 0 }}>
          {inProgress ? "Projected week totals" : "Week totals"}
        </h3>
        <div className="table-wrap">
          <table className="table-cards">
            <thead>
              <tr>
                <th>Team</th>
                <th>Through</th>
                {inProgress ? <th>Projected</th> : <th>Total</th>}
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
                    <Link
                      href={`/leagues/${league.league_id}/teams/${row.teamId}?season=${league.season}`}
                    >
                      <strong>{row.name}</strong>
                    </Link>
                  </td>
                  <td data-label="Through">
                    {formatPoints(row.week.week_total)}
                  </td>
                  <td data-label={inProgress ? "Projected" : "Total"}>
                    <strong>
                      {formatPoints(
                        inProgress
                          ? (row.week.week_projected ?? row.week.week_total)
                          : row.week.week_total,
                      )}
                    </strong>
                  </td>
                  <td data-label="Captain">
                    {formatPoints(row.week.captain_week)}
                  </td>
                  {(["1", "2", "3", "4"] as const).map((rnd) => (
                    <td
                      key={rnd}
                      data-label={row.week.by_round[rnd]?.label ?? rnd}
                    >
                      {Number(rnd) <= through
                        ? formatPoints(row.week.by_round[rnd]?.points ?? 0)
                        : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {inProgress ? (
          <p className="league-meta" style={{ marginBottom: 0 }}>
            Projected fills remaining rounds with the average of completed
            counted rounds — a disclosed heuristic, not a tour model.
          </p>
        ) : null}
      </div>
    </div>
  );
}
