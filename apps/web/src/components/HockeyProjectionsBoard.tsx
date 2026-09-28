import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import {
  backtestLine,
  effectiveRecent,
  formatPercent,
  formatValue,
  HOCKEY_BOARD_PAGE_SIZE,
  hockeyBoardRows,
  RECENT_STEPS,
  recentLabel,
  SOURCE_LABELS,
  type HockeyBoardQuery,
  type HockeyValuesSnapshot,
} from "@/lib/hockey-values";

type Props = {
  leagueId: string;
  season: number;
  snapshot: HockeyValuesSnapshot | null;
  query: HockeyBoardQuery;
  teamNames: Record<number, string>;
};

function boardHref(
  leagueId: string,
  season: number,
  query: HockeyBoardQuery,
  patch: Partial<HockeyBoardQuery>,
): string {
  const q = { ...query, ...patch };
  const params = new URLSearchParams({ season: String(season), tab: "projections" });
  if (q.pos !== "all") params.set("pos", q.pos);
  if (q.who !== "all") params.set("who", q.who);
  if (q.sort !== "value") params.set("sort", q.sort);
  params.set("dir", q.dir);
  if (q.recent != null) params.set("recent", String(q.recent));
  if (q.page > 1) params.set("p", String(q.page));
  if (q.open) params.set("open", q.open);
  return `/leagues/${leagueId}?${params.toString()}${q.open ? `#row-${q.open}` : ""}`;
}

function SortHeader({
  id,
  label,
  numeric,
  leagueId,
  season,
  query,
}: {
  id: HockeyBoardQuery["sort"];
  label: string;
  numeric?: boolean;
  leagueId: string;
  season: number;
  query: HockeyBoardQuery;
}) {
  const active = query.sort === id;
  const dir = active ? (query.dir === "desc" ? "asc" : "desc") : id === "name" ? "asc" : "desc";
  return (
    <th
      className={numeric ? "numeric" : undefined}
      aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <Link
        href={boardHref(leagueId, season, query, { sort: id, dir, page: 1, open: null })}
        className="sort-button"
      >
        {label}
        <span className="sort-indicator" aria-hidden="true">
          {active ? (query.dir === "asc" ? " ▲" : " ▼") : ""}
        </span>
      </Link>
    </th>
  );
}

/** Hockey projections tab (HOCKEY-PORT.md H2/H3): value, ROS, ESPN, breakdown. */
export function HockeyProjectionsBoard({ leagueId, season, snapshot, query, teamNames }: Props) {
  if (!snapshot) {
    return (
      <EmptyState title="No hockey player values yet">
        Values are written by <code>sj sync</code> (or <code>sj nhl</code>) from ESPN
        plus the public NHL API. They appear after the next hockey sync.
      </EmptyState>
    );
  }
  const result = hockeyBoardRows(snapshot, query);
  const recent = effectiveRecent(snapshot, query);
  const accuracy = backtestLine(snapshot.backtest);
  const start = result.total ? (result.page - 1) * HOCKEY_BOARD_PAGE_SIZE + 1 : 0;
  const end = Math.min(result.page * HOCKEY_BOARD_PAGE_SIZE, result.total);
  const chip = (patch: Partial<HockeyBoardQuery>, active: boolean, label: string) => (
    <Link
      key={label}
      href={boardHref(leagueId, season, query, { ...patch, page: 1, open: null })}
      className={`filter-chip${active ? " active" : ""}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="data-table hockey-projections">
      <p className="lede" style={{ marginTop: "0.5rem" }}>
        Per-game value is a weighted blend of recent form, this season, ESPN&rsquo;s
        projection, age-adjusted NHL history, and a prospect estimate for rookies,
        scored under this league&rsquo;s rules
        {snapshot.model?.role_adjust ? " and adjusted for role (±25%)" : ""}. ROS =
        value × remaining games × expected share played. Estimates, not
        guarantees — open a row for its inputs.
      </p>
      <p className="muted" style={{ marginTop: 0 }}>
        As of {snapshot.as_of} · scoring from{" "}
        {snapshot.scoring_source === "espn" ? "ESPN league settings" : "the SJ Hockey override"}
      </p>
      {accuracy ? (
        <p className="muted hockey-backtest-line" style={{ marginTop: 0 }}>
          {accuracy}
        </p>
      ) : null}

      <div className="table-filters" role="group" aria-label="Recent form" style={{ marginTop: "0.5rem" }}>
        {RECENT_STEPS.map((step) =>
          chip({ recent: step }, recent === step, recentLabel(step)),
        )}
      </div>
      <div className="table-filters" role="group" aria-label="Position filter" style={{ marginTop: "0.5rem" }}>
        {chip({ pos: "all" }, query.pos === "all", "All positions")}
        {chip({ pos: "F" }, query.pos === "F", "F")}
        {chip({ pos: "D" }, query.pos === "D", "D")}
        {chip({ pos: "G" }, query.pos === "G", "G")}
        {chip({ who: "all" }, query.who === "all", "Everyone")}
        {chip({ who: "rostered" }, query.who === "rostered", "Rostered")}
        {chip({ who: "fa" }, query.who === "fa", "Free agents")}
      </div>

      <div className="panel table-scroll" style={{ marginTop: "0.75rem" }}>
        <table className="table-cards">
          <thead>
            <tr>
              <SortHeader id="name" label="Player" leagueId={leagueId} season={season} query={query} />
              <th>Pos</th>
              <th>Team</th>
              <th>Owner</th>
              <SortHeader id="value" label="Value" numeric leagueId={leagueId} season={season} query={query} />
              <SortHeader id="ros" label="ROS" numeric leagueId={leagueId} season={season} query={query} />
              <SortHeader id="espn" label="ESPN /G" numeric leagueId={leagueId} season={season} query={query} />
              <SortHeader id="durability" label="Plays" numeric leagueId={leagueId} season={season} query={query} />
              <SortHeader id="age" label="Age" numeric leagueId={leagueId} season={season} query={query} />
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => {
              const id = String(row.espn_id);
              const isOpen = query.open === id;
              return [
              <tr key={id} id={`row-${id}`}>
                <td data-label="Player">
                  <Link
                    href={`/leagues/${leagueId}/players/${encodeURIComponent(id)}?season=${season}`}
                  >
                    {row.name ?? "—"}
                  </Link>
                  {row.durability?.iron_man ? (
                    <span title="Iron man: expected to play 95%+ of games"> 🦾</span>
                  ) : null}{" "}
                  <Link
                    className="value-breakdown-toggle"
                    href={boardHref(leagueId, season, query, { open: isOpen ? null : id })}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? "Hide inputs" : "Inputs"}
                  </Link>
                </td>
                <td data-label="Pos">{row.position ?? row.group}</td>
                <td data-label="Team">{row.nhl_team ?? "—"}</td>
                <td data-label="Owner">
                  {row.rostered
                    ? (row.fantasy_team_id != null ? teamNames[row.fantasy_team_id] : null) ?? "Rostered"
                    : "Free agent"}
                </td>
                <td className="numeric" data-label="Value">
                  {formatValue(row.blended.value)}
                </td>
                <td className="numeric" data-label="ROS">
                  {formatValue(row.blended.ros, 1)}
                </td>
                <td className="numeric" data-label="ESPN /G">
                  {formatValue(row.espn_proj?.per_game)}
                </td>
                <td className="numeric" data-label="Plays">
                  {formatPercent(row.durability?.rate)}
                </td>
                <td className="numeric" data-label="Age">
                  {row.age ?? "—"}
                </td>
                <td data-label="Source">
                  <span className={`value-source value-source-${row.source}`}>
                    {SOURCE_LABELS[row.source] ?? row.source}
                  </span>
                </td>
              </tr>,
              isOpen ? (
                <tr key={`${id}-inputs`} className="value-breakdown-row">
                  <td colSpan={10} data-label="Inputs">
                    <ul className="value-breakdown">
                      {row.blended.parts.map((part) => (
                        <li key={`${part.kind}-${part.label}`}>
                          {part.label}: {formatValue(part.fpg)} /G
                          {part.gp != null ? ` over ${part.gp} GP` : ""} ·{" "}
                          {formatPercent(part.share)} of the blend
                        </li>
                      ))}
                      {snapshot.model?.role_adjust === false ? null : (
                        <li>
                          Role adjustment ×{formatValue(row.mult)}
                          {row.adjustments.length ? ` (${row.adjustments.join(", ")})` : ""}
                        </li>
                      )}
                      <li>
                        Plays {formatPercent(row.durability?.rate)} — {row.durability?.basis}
                        {row.remaining_games != null
                          ? ` · ${row.remaining_games} team games left`
                          : " · schedule unknown"}
                      </li>
                    </ul>
                  </td>
                </tr>
              ) : null,
              ];
            })}
            {!result.rows.length ? (
              <tr className="table-empty-row">
                <td colSpan={10}>No players match these filters.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="table-pager" aria-live="polite">
        <span className="table-pager-meta">
          {result.total ? `Showing ${start}–${end} of ${result.total}` : "No results"}
        </span>
        <div className="table-pager-controls">
          {result.page > 1 ? (
            <Link
              className="button secondary"
              href={boardHref(leagueId, season, query, { page: result.page - 1, open: null })}
            >
              Previous
            </Link>
          ) : (
            <button type="button" className="button secondary" disabled>
              Previous
            </button>
          )}
          <span className="table-pager-page">
            Page {result.page} of {result.pages}
          </span>
          {result.page < result.pages ? (
            <Link
              className="button secondary"
              href={boardHref(leagueId, season, query, { page: result.page + 1, open: null })}
            >
              Next
            </Link>
          ) : (
            <button type="button" className="button secondary" disabled>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
