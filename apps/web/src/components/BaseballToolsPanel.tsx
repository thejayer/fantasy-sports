import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/EmptyState";
import { formatStat } from "@/lib/baseball";
import {
  BASEBALL_TOOL_CARDS,
  buildCategoryBoard,
  buildIpUsageBoard,
  type BaseballToolsView,
  type CategoryBoard,
  type CategoryId,
  type IpUsageBoard,
} from "@/lib/baseball-tools";
import type { LeagueSnapshot } from "@/lib/data";

function toolsHref(
  leagueId: string,
  season: number,
  view: BaseballToolsView,
): string {
  const query = new URLSearchParams({
    season: String(season),
    tab: "tools",
    view,
  });
  return `/leagues/${leagueId}?${query.toString()}`;
}

function ViewSwitcher({
  leagueId,
  season,
  view,
}: {
  leagueId: string;
  season: number;
  view: BaseballToolsView;
}) {
  const views: Array<{ id: BaseballToolsView; label: string }> = [
    { id: "home", label: "Tools" },
    ...BASEBALL_TOOL_CARDS.map((card) => ({
      id: card.id as BaseballToolsView,
      label: card.name,
    })),
  ];
  return (
    <div className="tabs" style={{ marginTop: "0.5rem" }}>
      {views.map((item) => (
        <Link
          key={item.id}
          href={toolsHref(leagueId, season, item.id)}
          className={`tab${view === item.id ? " active" : ""}`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

function CategoryBoardView({ board }: { board: CategoryBoard }) {
  return (
    <section style={{ marginTop: "0.75rem" }}>
      <p className="lede" style={{ marginTop: 0 }}>
        Category ranks from roster season stats — not a projection model.
      </p>
      <p className="league-meta">{board.disclaimer}</p>
      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th>Team</th>
              <th className="numeric">Roto</th>
              {board.categories.map((cat) => (
                <th key={cat.id} className="numeric">
                  {cat.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => (
              <tr key={row.teamId}>
                <td data-label="Team">{row.name}</td>
                <td data-label="Roto" className="numeric">
                  {formatStat(row.rotoPoints, 1)}
                  <span className="muted"> (#{formatStat(row.rotoRank, 0)})</span>
                </td>
                {board.categories.map((cat) => {
                  const cell = row.cells[cat.id as CategoryId];
                  return (
                    <td key={cat.id} data-label={cat.label} className="numeric">
                      {formatStat(cell?.value, cat.digits)}
                      {cell?.rank != null ? (
                        <span className="muted"> · #{formatStat(cell.rank, 0)}</span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PendingTool({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div style={{ marginTop: "0.75rem" }}>
      <EmptyState title={title}>{children}</EmptyState>
    </div>
  );
}

/**
 * Baseball projection-free toolkit (roadmap 8.2).
 * Distinct from football ``ToolsPanel`` — no ffa / projection joins.
 */
export function BaseballToolsPanel({
  league,
  view = "home",
}: {
  league: LeagueSnapshot;
  view?: BaseballToolsView;
}) {
  const leagueId = league.league_id;
  const season = league.season;
  const active: BaseballToolsView =
    view === "home" || BASEBALL_TOOL_CARDS.some((c) => c.id === view)
      ? view
      : "home";

  const categoryBoard =
    active === "categories" ? buildCategoryBoard(league) : null;
  const ipBoard = active === "usage" ? buildIpUsageBoard(league) : null;

  return (
    <div className="baseball-tools-panel">
      <ViewSwitcher leagueId={leagueId} season={season} view={active} />

      {active === "home" ? (
        <section style={{ marginTop: "0.75rem" }}>
          <p className="lede" style={{ marginTop: 0 }}>
            Scheduling and roster arithmetic — still projection-free (roadmap
            4.6 / 8.2). Free agents stay on the Waivers tab.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "0.75rem",
              marginTop: "0.75rem",
            }}
          >
            {BASEBALL_TOOL_CARDS.map((card) => (
              <Link
                key={card.id}
                href={toolsHref(leagueId, season, card.id)}
                className="panel"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <h3 className="roster-group-title" style={{ marginTop: 0 }}>
                  {card.name}
                  {!card.ready ? (
                    <span className="muted" style={{ fontWeight: 400 }}>
                      {" "}
                      · needs sync
                    </span>
                  ) : null}
                </h3>
                <p className="league-meta" style={{ marginBottom: 0 }}>
                  {card.promise}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {active === "categories" && categoryBoard ? (
        <CategoryBoardView board={categoryBoard} />
      ) : null}

      {active === "usage" && ipBoard ? (
        <UsageBoardViewLinked league={league} board={ipBoard} />
      ) : null}

      {active === "trailing" ? (
        <PendingTool title="Trailing windows need split sync">
          ESPN <code>PR7</code> / <code>PR15</code> / <code>PR30</code> splits are
          not in the season snapshot yet (player parse keeps the season bucket
          only). Season counting stats power the Category Board today.
        </PendingTool>
      ) : null}

      {active === "schedule" ? (
        <PendingTool title="Week Forecaster needs an MLB schedule feed">
          Games-per-team and two-start pitchers need pro schedule + probable
          starters — the only 8.2 item that requires a feed. Roster{" "}
          <code>pro_team</code> alone is not enough.
        </PendingTool>
      ) : null}

      {active === "locks" ? (
        <PendingTool title="Daily locks need game start times">
          Baseball lineups lock per game, not per matchup period. The hub still
          treats baseball weeks as ESPN periods until a schedule clock lands
          (golf <code>lineupClock</code> is the UX analogue, not the data).
        </PendingTool>
      ) : null}
    </div>
  );
}

function UsageBoardViewLinked({
  league,
  board,
}: {
  league: LeagueSnapshot;
  board: IpUsageBoard;
}) {
  return (
    <section style={{ marginTop: "0.75rem" }}>
      <p className="lede" style={{ marginTop: 0 }}>
        Season IP vs a {board.seasonMaxSource === "default" ? "default" : "settings"}{" "}
        ceiling of {formatStat(board.seasonMax, 0)}.
      </p>
      <p className="league-meta">{board.disclaimer}</p>
      <h3 className="roster-group-title">Team IP</h3>
      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th>Team</th>
              <th className="numeric">IP</th>
              <th className="numeric">Remaining</th>
              <th className="numeric">Used</th>
            </tr>
          </thead>
          <tbody>
            {board.teams.map((row) => (
              <tr key={row.teamId}>
                <td data-label="Team">
                  <Link
                    href={`/leagues/${league.league_id}/teams/${row.teamId}?season=${league.season}`}
                  >
                    {row.name}
                  </Link>
                </td>
                <td data-label="IP" className="numeric">
                  {formatStat(row.ip, 1)}
                </td>
                <td data-label="Remaining" className="numeric">
                  {formatStat(row.remaining, 1)}
                </td>
                <td data-label="Used" className="numeric">
                  {formatStat(row.pct * 100, 0)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="roster-group-title">Pitcher IP leaders</h3>
      {!board.pitchers.length ? (
        <EmptyState title="No pitcher IP in this snapshot">
          Pitcher season_stats appear after ESPN sync.
        </EmptyState>
      ) : (
        <div className="panel table-scroll">
          <table className="table-cards">
            <thead>
              <tr>
                <th>Pitcher</th>
                <th>Team</th>
                <th className="numeric">IP</th>
              </tr>
            </thead>
            <tbody>
              {board.pitchers.map((row) => (
                <tr key={`${row.teamId}-${row.playerId}`}>
                  <td data-label="Pitcher">
                    {row.playerId != null ? (
                      <Link
                        href={`/leagues/${league.league_id}/players/${row.playerId}?season=${league.season}`}
                      >
                        {row.name}
                      </Link>
                    ) : (
                      row.name
                    )}
                  </td>
                  <td data-label="Team">{row.teamName}</td>
                  <td data-label="IP" className="numeric">
                    {formatStat(row.ip, 1)}
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
