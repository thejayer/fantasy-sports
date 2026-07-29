import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import type { LeagueSnapshot } from "@/lib/data";
import { DEFAULT_GOLF_SETTINGS, parseGolfSettings } from "@/lib/golf";

function formatMult(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/** Curated FedEx fixture slate + multipliers (roadmap 6.5). */
export function GolfSchedulePanel({ league }: { league: LeagueSnapshot }) {
  const golf = parseGolfSettings(league.settings) ?? DEFAULT_GOLF_SETTINGS;
  const events = league.lineups?.events ?? [];
  const mults = golf.multipliers;

  if (!events.length) {
    return (
      <EmptyState title="FedExCup schedule not loaded yet">
        Fixture events ship with create/seed lineups. Live slate ingest stays a
        later feed concern — offline curated events only for now.
      </EmptyState>
    );
  }

  return (
    <div className="golf-schedule-panel" style={{ marginTop: "0.75rem" }}>
      <p className="lede">
        Curated FedExCup counting slate · multipliers regular ×
        {formatMult(mults.regular)}, signature ×{formatMult(mults.signature)},
        major ×{formatMult(mults.major)}.
      </p>
      <div className="panel table-scroll" style={{ marginTop: "0.75rem" }}>
        <table className="table-cards">
          <thead>
            <tr>
              <th>Week</th>
              <th>Event</th>
              <th>Tier</th>
              <th>×</th>
              <th>Starts (UTC)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const tier = event.multiplier_tier as keyof typeof mults;
              const mult =
                typeof mults[tier] === "number" ? mults[tier] : mults.regular;
              return (
                <tr key={event.event_id}>
                  <td data-label="Week">{event.week}</td>
                  <td data-label="Event">{event.name}</td>
                  <td data-label="Tier">{event.multiplier_tier}</td>
                  <td data-label="×">{formatMult(mult)}</td>
                  <td data-label="Starts">
                    {new Date(event.starts_at).toLocaleString()}
                  </td>
                  <td data-label="">
                    <Link
                      href={`/leagues/${league.league_id}?season=${league.season}&tab=lineup&event=${event.event_id}`}
                    >
                      Set lineup
                    </Link>
                    {" · "}
                    <Link
                      href={`/leagues/${league.league_id}?season=${league.season}&tab=scoreboard&event=${event.event_id}`}
                    >
                      Scoreboard
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
