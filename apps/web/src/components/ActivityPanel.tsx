import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import type { LeagueSnapshot } from "@/lib/data";
import {
  activityRowsForLeague,
  type ActivityView,
} from "@/lib/activity";

function ViewSwitcher({
  leagueId,
  season,
  view,
}: {
  leagueId: string;
  season: number;
  view: ActivityView;
}) {
  const views: Array<{ id: ActivityView; label: string }> = [
    { id: "all", label: "All" },
    { id: "trades", label: "Trades" },
    { id: "waivers", label: "Adds / drops" },
  ];
  return (
    <div className="tabs" style={{ marginTop: "0.5rem" }}>
      {views.map((item) => (
        <Link
          key={item.id}
          href={`/leagues/${leagueId}?season=${season}&tab=activity&view=${item.id}`}
          className={`tab${view === item.id ? " active" : ""}`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

export function ActivityPanel({
  league,
  view = "all",
}: {
  league: LeagueSnapshot;
  view?: ActivityView;
}) {
  const all = activityRowsForLeague(league, "all");
  const rows = activityRowsForLeague(league, view);

  if (!all.length) {
    return (
      <EmptyState title="No transactions in this snapshot">
        ESPN <code>recent_activity</code> is empty for some seasons (notably
        before 2019) or when nothing has moved yet. Re-run <code>sj sync</code>{" "}
        for the current season to refresh.
      </EmptyState>
    );
  }

  const showBids = all.some((row) => row.bidAmount > 0);

  return (
    <div className="activity-panel" style={{ marginTop: "0.75rem" }}>
      <p className="lede">
        League activity from ESPN ({all.length} actions). Trades and
        adds/drops share one ledger; FAAB bids show when present.
      </p>
      <ViewSwitcher
        leagueId={league.league_id}
        season={league.season}
        view={view}
      />
      {!rows.length ? (
        <EmptyState title="Nothing in this filter">
          Try All, or switch to another activity view.
        </EmptyState>
      ) : (
        <div className="panel table-scroll" style={{ marginTop: "0.75rem" }}>
          <table className="table-cards">
            <thead>
              <tr>
                <th>Date</th>
                <th>Team</th>
                <th>Action</th>
                <th>Player</th>
                {showBids ? <th className="numeric">Bid</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td data-label="Date">{row.dateLabel}</td>
                  <td data-label="Team">
                    {row.teamId != null ? (
                      <Link
                        href={`/leagues/${league.league_id}/teams/${row.teamId}?season=${league.season}`}
                      >
                        {row.teamName}
                      </Link>
                    ) : (
                      row.teamName
                    )}
                  </td>
                  <td data-label="Action">{row.action}</td>
                  <td data-label="Player">{row.playerName}</td>
                  {showBids ? (
                    <td data-label="Bid" className="numeric">
                      {row.bidAmount > 0 ? row.bidAmount.toFixed(0) : "—"}
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
