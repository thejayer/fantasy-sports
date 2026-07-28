import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import type { LeagueSnapshot } from "@/lib/data";
import {
  draftHasBids,
  draftHasKeepers,
  draftResultRows,
} from "@/lib/draft-results";

export function DraftResultsPanel({
  league,
  teamId,
}: {
  league: LeagueSnapshot;
  teamId?: number;
}) {
  const picks = league.draft ?? [];
  const rows = draftResultRows(league, teamId);
  const showBids = draftHasBids(picks);
  const showKeepers = draftHasKeepers(picks);

  if (!picks.length) {
    return (
      <EmptyState title="No draft results in this snapshot">
        ESPN draft picks land in <code>draft.json</code> after{" "}
        <code>sj sync</code> / <code>sj backfill</code>. This is the historical
        draft board — not the Monte Carlo Draft tool under Tools.
      </EmptyState>
    );
  }

  return (
    <div className="draft-results-panel" style={{ marginTop: "0.75rem" }}>
      <p className="lede">
        ESPN draft results · {picks.length} picks
        {showKeepers ? " · includes keepers" : ""}
        {showBids ? " · auction bids shown when present" : ""}. Filter by team
        below. Football Monte Carlo slot sims stay under Tools → Draft.
      </p>

      <div className="tabs" style={{ marginTop: "0.5rem" }}>
        <Link
          href={`/leagues/${league.league_id}?season=${league.season}&tab=draft`}
          className={`tab${teamId == null ? " active" : ""}`}
        >
          All teams
        </Link>
        {league.teams.map((team) => (
          <Link
            key={team.team_id}
            href={`/leagues/${league.league_id}?season=${league.season}&tab=draft&team=${team.team_id}`}
            className={`tab${teamId === team.team_id ? " active" : ""}`}
          >
            {team.abbrev || team.name}
          </Link>
        ))}
      </div>

      {!rows.length ? (
        <EmptyState title="No picks for this team">
          That franchise has no draft rows in this season snapshot.
        </EmptyState>
      ) : (
        <div className="panel table-scroll" style={{ marginTop: "0.75rem" }}>
          <table className="table-cards">
            <thead>
              <tr>
                <th>#</th>
                <th>Rd</th>
                <th>Pick</th>
                <th>Team</th>
                <th>Player</th>
                {showKeepers ? <th>Keeper</th> : null}
                {showBids ? <th className="numeric">Bid</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.round}-${row.round_pick}-${row.player_id}-${row.pickIndex}`}>
                  <td data-label="#">{row.pickIndex}</td>
                  <td data-label="Rd">{row.round ?? "—"}</td>
                  <td data-label="Pick">{row.round_pick ?? "—"}</td>
                  <td data-label="Team">
                    {row.team_id != null ? (
                      <Link
                        href={`/leagues/${league.league_id}/teams/${row.team_id}?season=${league.season}`}
                      >
                        {row.teamName}
                      </Link>
                    ) : (
                      row.teamName
                    )}
                  </td>
                  <td data-label="Player">{row.player_name ?? "—"}</td>
                  {showKeepers ? (
                    <td data-label="Keeper">{row.keeper ? "Yes" : "—"}</td>
                  ) : null}
                  {showBids ? (
                    <td data-label="Bid" className="numeric">
                      {(row.bid_amount ?? 0) > 0
                        ? row.bid_amount.toFixed(0)
                        : "—"}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
