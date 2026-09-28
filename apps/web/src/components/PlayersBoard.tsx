/**
 * Server-rendered players board (roadmap 7.11).
 * Search / sort / page via searchParams — only one page of slim rows in HTML.
 */

import Link from "next/link";
import type { Player } from "@/lib/data";
import { formatStat } from "@/lib/baseball";
import { injuryTone } from "@/lib/league";
import {
  formatProjectionPoints,
  type PlayerWithProjection,
  type ProjectionCoverage,
} from "@/lib/projection-join";
import {
  playersTableHref,
  type PlayerTableQuery,
  type SlimPlayerRow,
  queryPlayerTable,
} from "@/lib/player-table";
import type { SortDirection } from "@/lib/table";

function StatusDot({ row }: { row: SlimPlayerRow }) {
  const stub: Player = {
    id: row.id,
    name: row.name,
    position: row.position,
    slot: row.position,
    pro_team: row.pro_team,
    injury_status: row.injury_status,
    status: row.status,
    total_points: row.total_points,
    projected_total_points: null,
    avg_points: null,
  };
  const tone = injuryTone(stub);
  const label = row.injury_status || row.status || "OK";
  return <span className={`status-dot ${tone}`} title={label} />;
}

function SortHeader({
  id,
  label,
  query,
  leagueId,
  season,
  role,
  numeric,
}: {
  id: string;
  label: string;
  query: PlayerTableQuery;
  leagueId: string;
  season: number;
  role: string;
  numeric?: boolean;
}) {
  const active = query.sort === id;
  const nextDir: SortDirection =
    active && query.dir === "desc" ? "asc" : "desc";
  const href = playersTableHref(leagueId, season, {
    role,
    q: query.q,
    pos: query.pos,
    sort: id,
    dir: active ? nextDir : id === "name" || id === "position" || id === "pro_team" || id === "fantasy_team" ? "asc" : "desc",
    page: 1,
  });
  return (
    <th className={numeric ? "numeric" : undefined} aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={href} className="sort-button">
        {label}
        <span className="sort-indicator" aria-hidden="true">
          {active ? (query.dir === "asc" ? " ▲" : " ▼") : ""}
        </span>
      </Link>
    </th>
  );
}

function PlayerName({
  row,
  leagueId,
  season,
}: {
  row: SlimPlayerRow;
  leagueId: string;
  season: number;
}) {
  const label = row.name ?? "—";
  if (row.id == null) return <>{label}</>;
  return (
    <Link
      href={`/leagues/${leagueId}/players/${encodeURIComponent(String(row.id))}?season=${season}`}
    >
      {label}
    </Link>
  );
}

export function PlayersBoard({
  players,
  sport,
  role = "all",
  showProjections = false,
  leagueId,
  season,
  query,
  projectionCoverage = null,
}: {
  players: Array<Player | PlayerWithProjection>;
  sport: string;
  role?: string;
  showProjections?: boolean;
  leagueId: string;
  season: number;
  query: PlayerTableQuery;
  projectionCoverage?: ProjectionCoverage | null;
}) {
  const noCoverage = Boolean(
    projectionCoverage && projectionCoverage.mapped === 0,
  );
  const partialCoverage = Boolean(
    projectionCoverage &&
      projectionCoverage.mapped > 0 &&
      projectionCoverage.mapped < projectionCoverage.total,
  );
  const useProj = showProjections && sport === "football" && !noCoverage;
  const result = queryPlayerTable(players, query);
  const rangeStart =
    result.filteredCount === 0
      ? 0
      : (result.page - 1) * 25 + 1;
  const rangeEnd = Math.min(result.page * 25, result.filteredCount);

  // role=all used to emit both batter and pitcher columns (mostly dashes) and
  // pushed the document over the 100 KB HTML budget. Counting stats require an
  // explicit Batter / Pitcher filter; the combined view stays identity + FPts.
  const baseballBatterCols = sport === "baseball" && role === "batter";
  const baseballPitcherCols = sport === "baseball" && role === "pitcher";

  return (
    <div className="data-table players-board">
      {sport === "baseball" && role === "all" ? (
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          Showing every rostered player. Switch to Batters or Pitchers for
          counting-stat columns.
        </p>
      ) : null}
      {projectionCoverage && sport === "football" ? (
        <p className="muted projection-coverage">
          {noCoverage
            ? "No engine projections joined for this league — the ESPN↔nflverse player map has no entry for these roster ids, so floor/median/ceiling columns are hidden."
            : partialCoverage
              ? `Floor / Med / Ceil / VOR resolved for ${projectionCoverage.mapped} of ${projectionCoverage.total} players (${Math.round(projectionCoverage.rate * 100)}%) through the player map.`
              : `Floor / Med / Ceil / VOR resolved for all ${projectionCoverage.total} players.`}
        </p>
      ) : null}

      <form className="table-toolbar" method="get" action={`/leagues/${leagueId}`}>
        <input type="hidden" name="season" value={season} />
        <input type="hidden" name="tab" value="players" />
        {role !== "all" ? <input type="hidden" name="role" value={role} /> : null}
        <input type="hidden" name="sort" value={query.sort} />
        <input type="hidden" name="dir" value={query.dir} />
        {query.pos ? <input type="hidden" name="pos" value={query.pos} /> : null}
        <label className="table-search">
          <span className="sr-only">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={query.q}
            placeholder="Search players…"
          />
        </label>
        <button type="submit" className="button secondary">
          Search
        </button>
      </form>

      {result.positions.length > 1 ? (
        <div
          className="table-filters"
          role="group"
          aria-label="Position filter"
          style={{ marginTop: "0.5rem" }}
        >
          <Link
            href={playersTableHref(leagueId, season, {
              role,
              q: query.q,
              pos: null,
              sort: query.sort,
              dir: query.dir,
              page: 1,
            })}
            className={`filter-chip${query.pos == null ? " active" : ""}`}
          >
            All positions
          </Link>
          {result.positions.map((option) => (
            <Link
              key={option}
              href={playersTableHref(leagueId, season, {
                role,
                q: query.q,
                pos: option,
                sort: query.sort,
                dir: query.dir,
                page: 1,
              })}
              className={`filter-chip${query.pos === option ? " active" : ""}`}
            >
              {option}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="panel table-scroll" style={{ marginTop: "0.75rem" }}>
        <table className="table-cards">
          <thead>
            <tr>
              <th className="narrow" />
              <SortHeader id="name" label="Player" query={query} leagueId={leagueId} season={season} role={role} />
              <SortHeader id="position" label="Pos" query={query} leagueId={leagueId} season={season} role={role} />
              <SortHeader
                id="pro_team"
                label={sport === "baseball" ? "Team" : "Pro"}
                query={query}
                leagueId={leagueId}
                season={season}
                role={role}
              />
              <SortHeader id="fantasy_team" label="Fantasy" query={query} leagueId={leagueId} season={season} role={role} />
              {baseballBatterCols ? (
                <>
                  <SortHeader id="R" label="R" query={query} leagueId={leagueId} season={season} role={role} numeric />
                  <SortHeader id="HR" label="HR" query={query} leagueId={leagueId} season={season} role={role} numeric />
                  <SortHeader id="RBI" label="RBI" query={query} leagueId={leagueId} season={season} role={role} numeric />
                  <SortHeader id="SB" label="SB" query={query} leagueId={leagueId} season={season} role={role} numeric />
                  <SortHeader id="AVG" label="AVG" query={query} leagueId={leagueId} season={season} role={role} numeric />
                  <SortHeader id="OPS" label="OPS" query={query} leagueId={leagueId} season={season} role={role} numeric />
                </>
              ) : null}
              {baseballPitcherCols ? (
                <>
                  <SortHeader id="IP" label="IP" query={query} leagueId={leagueId} season={season} role={role} numeric />
                  <SortHeader id="W" label="W" query={query} leagueId={leagueId} season={season} role={role} numeric />
                  <SortHeader id="SV" label="SV" query={query} leagueId={leagueId} season={season} role={role} numeric />
                  <SortHeader id="K" label="K" query={query} leagueId={leagueId} season={season} role={role} numeric />
                  <SortHeader id="ERA" label="ERA" query={query} leagueId={leagueId} season={season} role={role} numeric />
                  <SortHeader id="WHIP" label="WHIP" query={query} leagueId={leagueId} season={season} role={role} numeric />
                </>
              ) : null}
              <SortHeader id="fpts" label="FPts" query={query} leagueId={leagueId} season={season} role={role} numeric />
              {useProj ? (
                <>
                  <SortHeader id="floor" label="Floor" query={query} leagueId={leagueId} season={season} role={role} numeric />
                  <SortHeader id="median" label="Med" query={query} leagueId={leagueId} season={season} role={role} numeric />
                  <SortHeader id="ceiling" label="Ceil" query={query} leagueId={leagueId} season={season} role={role} numeric />
                  <SortHeader id="vor" label="VOR" query={query} leagueId={leagueId} season={season} role={role} numeric />
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => {
              return (
                <tr key={`${row.id}-${row.name}`}>
                  <td className="narrow" data-label="">
                    <StatusDot row={row} />
                  </td>
                  <td data-label="Player">
                    <PlayerName row={row} leagueId={leagueId} season={season} />
                  </td>
                  <td data-label="Pos">{row.position ?? "—"}</td>
                  <td data-label={sport === "baseball" ? "Team" : "Pro"}>
                    {row.pro_team ?? "—"}
                  </td>
                  <td data-label="Fantasy">{row.fantasy_team ?? "—"}</td>
                  {baseballBatterCols ? (
                    <>
                      <td className="numeric" data-label="R">
                        {formatStat(row.R)}
                      </td>
                      <td className="numeric" data-label="HR">
                        {formatStat(row.HR)}
                      </td>
                      <td className="numeric" data-label="RBI">
                        {formatStat(row.RBI)}
                      </td>
                      <td className="numeric" data-label="SB">
                        {formatStat(row.SB)}
                      </td>
                      <td className="numeric" data-label="AVG">
                        {formatStat(row.AVG, 3)}
                      </td>
                      <td className="numeric" data-label="OPS">
                        {formatStat(row.OPS, 3)}
                      </td>
                    </>
                  ) : null}
                  {baseballPitcherCols ? (
                    <>
                      <td className="numeric" data-label="IP">
                        {formatStat(row.IP, 1)}
                      </td>
                      <td className="numeric" data-label="W">
                        {formatStat(row.W)}
                      </td>
                      <td className="numeric" data-label="SV">
                        {formatStat(row.SV)}
                      </td>
                      <td className="numeric" data-label="K">
                        {formatStat(row.K)}
                      </td>
                      <td className="numeric" data-label="ERA">
                        {formatStat(row.ERA, 2)}
                      </td>
                      <td className="numeric" data-label="WHIP">
                        {formatStat(row.WHIP, 2)}
                      </td>
                    </>
                  ) : null}
                  <td className="numeric" data-label="FPts">
                    {row.total_points?.toFixed?.(1) ?? "—"}
                  </td>
                  {useProj ? (
                    <>
                      <td className="numeric" data-label="Floor">
                        {formatProjectionPoints(row.floor)}
                      </td>
                      <td className="numeric" data-label="Med">
                        {formatProjectionPoints(row.median)}
                      </td>
                      <td className="numeric" data-label="Ceil">
                        {formatProjectionPoints(row.ceiling)}
                      </td>
                      <td className="numeric" data-label="VOR">
                        {formatProjectionPoints(row.vor)}
                      </td>
                    </>
                  ) : null}
                </tr>
              );
            })}
            {!result.rows.length ? (
              <tr className="table-empty-row">
                <td colSpan={20} data-label="">
                  No players match this search or filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="table-pager" aria-live="polite">
        <span className="table-pager-meta">
          {result.filteredCount
            ? `Showing ${rangeStart}–${rangeEnd} of ${result.filteredCount}`
            : "No results"}
          {result.filteredCount !== result.totalCount
            ? ` (${result.totalCount} total)`
            : ""}
        </span>
        <div className="table-pager-controls">
          {result.page > 1 ? (
            <Link
              className="button secondary"
              href={playersTableHref(leagueId, season, {
                role,
                q: query.q,
                pos: query.pos,
                sort: query.sort,
                dir: query.dir,
                page: result.page - 1,
              })}
            >
              Previous
            </Link>
          ) : (
            <button type="button" className="button secondary" disabled>
              Previous
            </button>
          )}
          <span className="table-pager-page">
            Page {result.page} of {result.pageCount}
          </span>
          {result.page < result.pageCount ? (
            <Link
              className="button secondary"
              href={playersTableHref(leagueId, season, {
                role,
                q: query.q,
                pos: query.pos,
                sort: query.sort,
                dir: query.dir,
                page: result.page + 1,
              })}
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
