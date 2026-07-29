import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import type { LeagueSnapshot } from "@/lib/data";
import {
  draftHasBids,
  draftHasKeepers,
  draftResultRows,
} from "@/lib/draft-results";
import { draftBudgetRows, type GolfDraftPick } from "@/lib/golf-draft";
import { DEFAULT_GOLF_SETTINGS, parseGolfSettings } from "@/lib/golf";

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
  const showNominator = picks.some((p) => p.nominating_team_id != null);

  const isGolf = league.sport === "golf";
  const golf = isGolf
    ? (parseGolfSettings(league.settings) ?? DEFAULT_GOLF_SETTINGS)
    : null;
  const isAuction = golf?.draft.style === "auction";
  const nameById = new Map(league.teams.map((t) => [t.team_id, t.name]));
  const budgetRows =
    isGolf && (isAuction || showBids)
      ? draftBudgetRows(
          league.teams,
          picks as GolfDraftPick[],
          golf?.draft.budget ?? DEFAULT_GOLF_SETTINGS.draft.budget,
        )
      : [];

  if (!picks.length) {
    return (
      <EmptyState title="No draft results in this snapshot">
        {isGolf ? (
          <>
            Draft the synthetic OWGR pool with <code>sg create-league</code> or
            hub Create golf league (snake or auction, optional keepers).
          </>
        ) : (
          <>
            ESPN draft picks land in <code>draft.json</code> after{" "}
            <code>sj sync</code> / <code>sj backfill</code>. This is the
            historical draft board — not the Monte Carlo Draft tool under Tools.
          </>
        )}
      </EmptyState>
    );
  }

  const golfLede = isAuction
    ? `OWGR auction · ${picks.length} picks · $${golf?.draft.budget ?? "?"} budget · first 5 slots GS, rest BE${
        showKeepers ? " · includes keepers" : ""
      }.`
    : `OWGR snake draft · ${picks.length} picks · first 5 slots per team are GS (starters), rest BE${
        showKeepers ? " · early rounds marked keepers" : ""
      }. Weekly Alt1/Alt2 live on Lineup.`;

  return (
    <div className="draft-results-panel" style={{ marginTop: "0.75rem" }}>
      <p className="lede">
        {isGolf
          ? golfLede
          : `ESPN draft results · ${picks.length} picks${
              showKeepers ? " · includes keepers" : ""
            }${showBids ? " · auction bids shown when present" : ""}. Filter by team below. Football Monte Carlo slot sims stay under Tools → Draft.`}
      </p>
      {isGolf && isAuction && !picks.length ? (
        <p className="league-meta">
          No picks yet.{" "}
          <Link
            href={`/leagues/${league.league_id}?season=${league.season}&tab=auction&team=1`}
          >
            Open live nomination room
          </Link>{" "}
          or recreate with an offline auction draft.
        </p>
      ) : null}

      {budgetRows.length ? (
        <div className="panel table-scroll" style={{ marginTop: "0.75rem" }}>
          <h3 style={{ margin: "0.75rem 1rem 0" }}>Auction budgets</h3>
          <table className="table-cards">
            <thead>
              <tr>
                <th>Team</th>
                <th>Picks</th>
                {showKeepers ? <th>Keepers</th> : null}
                <th className="numeric">Spent</th>
                <th className="numeric">Left</th>
              </tr>
            </thead>
            <tbody>
              {budgetRows.map((row) => (
                <tr key={row.team_id}>
                  <td data-label="Team">
                    <Link
                      href={`/leagues/${league.league_id}/teams/${row.team_id}?season=${league.season}`}
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td data-label="Picks">{row.picks}</td>
                  {showKeepers ? (
                    <td data-label="Keepers">{row.keepers}</td>
                  ) : null}
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
                {showNominator ? <th>Nominated by</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.round}-${row.round_pick}-${row.player_id}-${row.pickIndex}`}
                >
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
                        ? `$${row.bid_amount.toFixed(0)}`
                        : "—"}
                    </td>
                  ) : null}
                  {showNominator ? (
                    <td data-label="Nominated by">
                      {row.nominating_team_id != null
                        ? (nameById.get(row.nominating_team_id) ??
                          `#${row.nominating_team_id}`)
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
