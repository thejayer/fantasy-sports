import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import type { LeagueSnapshot, Team } from "@/lib/data";
import { droppedPlayersForTeam } from "@/lib/activity";

/**
 * Players this franchise dropped in the synced ESPN activity (roadmap 7.4).
 * Unique by player id; a player dropped twice is one row with a count.
 */
export function DroppedPlayersPanel({
  league,
  team,
}: {
  league: LeagueSnapshot;
  team: Team;
}) {
  if (league.sport === "golf") return null;

  const rows = droppedPlayersForTeam(league, team.team_id);
  const uniqueCount = rows.length;
  const eventCount = rows.reduce((sum, row) => sum + row.dropCount, 0);
  const feedHref = `/leagues/${league.league_id}?season=${league.season}&tab=activity&view=waivers`;

  return (
    <section className="dropped-players">
      <div className="game-log-head">
        <h3 className="roster-group-title">Dropped this season</h3>
        <p className="league-meta" style={{ margin: 0 }}>
          {uniqueCount === 0
            ? "none in synced activity"
            : `${uniqueCount} player${uniqueCount === 1 ? "" : "s"}`}
          {eventCount > uniqueCount ? ` · ${eventCount} drops` : ""}
        </p>
      </div>
      <p className="league-meta" style={{ margin: 0 }}>
        From ESPN recent activity in this snapshot.{" "}
        <Link href={feedHref}>League adds / drops</Link>
      </p>
      {!rows.length ? (
        <EmptyState title="No drops in the synced activity">
          Adds and drops appear after sync when ESPN returns recent activity
          for this season (empty before 2019). Very active baseball seasons
          may not include every early drop — sync pages up to 1,000 items.
        </EmptyState>
      ) : (
        <div className="panel table-scroll">
          <table className="table-cards">
            <thead>
              <tr>
                <th>Player</th>
                <th>Last dropped</th>
                <th className="numeric">Times</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td data-label="Player">
                    {row.playerId != null ? (
                      <Link
                        href={`/leagues/${league.league_id}/players/${row.playerId}?season=${league.season}`}
                      >
                        {row.playerName}
                      </Link>
                    ) : (
                      row.playerName
                    )}
                  </td>
                  <td data-label="Last dropped">{row.lastDateLabel}</td>
                  <td data-label="Times" className="numeric">
                    {row.dropCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
