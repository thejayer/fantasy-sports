"use client";

import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import { TeamIdentity } from "@/components/TeamAvatar";
import { ViewerBadge } from "@/components/ViewerBadge";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import type { LeagueSnapshot } from "@/lib/data";
import {
  buildChartModel,
  fpLabel,
  linePath,
  slotColumnsFor,
  slotTableRows,
  type AnalysisSeriesMode,
  type BaseballAnalysisSnapshot,
  type SlotTableRow,
} from "@/lib/baseball-analysis";
import { isSeasonPointsScoring } from "@/lib/scoring-type";

function teamHref(leagueId: string, season: number, teamId: number): string {
  return `/leagues/${leagueId}/teams/${teamId}?season=${season}`;
}

function SeriesSwitcher({
  leagueId,
  season,
  mode,
}: {
  leagueId: string;
  season: number;
  mode: AnalysisSeriesMode;
}) {
  const options: Array<{ id: AnalysisSeriesMode; label: string }> = [
    { id: "cumulative", label: "Cumulative" },
    { id: "daily", label: "Daily" },
    { id: "weekly", label: "Weekly" },
  ];
  return (
    <div className="tabs" style={{ marginTop: "0.5rem" }}>
      {options.map((item) => (
        <Link
          key={item.id}
          href={`/leagues/${leagueId}?season=${season}&tab=analysis&series=${item.id}`}
          className={`tab${mode === item.id ? " active" : ""}`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

function SlotTable({
  league,
  rows,
  columns,
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  rows: SlotTableRow[];
  columns: string[];
  viewerTeamId?: number;
}) {
  const tableColumns: DataTableColumn<SlotTableRow>[] = [
    {
      id: "team",
      header: "Team",
      sortable: true,
      sortValue: (row) => row.name,
      cell: (row) => {
        const team = league.teams.find((item) => item.team_id === row.team_id);
        return (
          <TeamIdentity name={row.name} logoUrl={team?.logo_url}>
            <Link href={teamHref(league.league_id, league.season, row.team_id)}>
              {row.name}
            </Link>
            {row.team_id === viewerTeamId ? <ViewerBadge /> : null}
          </TeamIdentity>
        );
      },
    },
    ...columns.map((slot) => ({
      id: slot,
      header: slot,
      sortable: true,
      numeric: true,
      defaultSortDirection: "desc" as const,
      sortValue: (row: SlotTableRow) => row.slots[slot] ?? 0,
      cell: (row: SlotTableRow) => fpLabel(row.slots[slot] ?? 0),
    })),
    {
      id: "starters",
      header: "Starters",
      sortable: true,
      numeric: true,
      defaultSortDirection: "desc",
      sortValue: (row) => row.starters,
      cell: (row) => fpLabel(row.starters),
    },
    {
      id: "espn",
      header: "ESPN team pts",
      sortable: true,
      numeric: true,
      defaultSortDirection: "desc",
      sortValue: (row) => row.espn_points,
      cell: (row) => fpLabel(row.espn_points),
    },
    {
      id: "bench",
      header: "Bench unused",
      sortable: true,
      numeric: true,
      defaultSortDirection: "desc",
      sortValue: (row) => row.bench_il,
      cell: (row) => fpLabel(row.bench_il),
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={tableColumns}
      getRowKey={(row) => String(row.team_id)}
      searchText={(row) => row.name}
      searchPlaceholder="Search teams…"
      pageSize={25}
      emptyMessage="No slot totals in this analysis snapshot."
      initialSort={{ columnId: "starters", direction: "desc" }}
    />
  );
}

function SplitTable({
  league,
  rows,
  viewerTeamId,
  isHockey,
}: {
  league: LeagueSnapshot;
  rows: SlotTableRow[];
  viewerTeamId?: number;
  isHockey: boolean;
}) {
  const leftId = isHockey ? "skaters" : "bats";
  const rightId = isHockey ? "goalies" : "pitchers";
  const leftHeader = isHockey ? "Skaters" : "Bats";
  const rightHeader = isHockey ? "Goalies" : "Pitchers";
  const leftValue = (row: SlotTableRow) =>
    isHockey ? row.skaters : row.bats;
  const rightValue = (row: SlotTableRow) =>
    isHockey ? row.goalies : row.pitchers;
  const columns: DataTableColumn<SlotTableRow>[] = [
    {
      id: "team",
      header: "Team",
      sortable: true,
      sortValue: (row) => row.name,
      cell: (row) => {
        const team = league.teams.find((item) => item.team_id === row.team_id);
        return (
          <TeamIdentity name={row.name} logoUrl={team?.logo_url}>
            <Link href={teamHref(league.league_id, league.season, row.team_id)}>
              {row.name}
            </Link>
            {row.team_id === viewerTeamId ? <ViewerBadge /> : null}
          </TeamIdentity>
        );
      },
    },
    {
      id: leftId,
      header: leftHeader,
      sortable: true,
      numeric: true,
      defaultSortDirection: "desc",
      sortValue: leftValue,
      cell: (row) => fpLabel(leftValue(row)),
    },
    {
      id: rightId,
      header: rightHeader,
      sortable: true,
      numeric: true,
      defaultSortDirection: "desc",
      sortValue: rightValue,
      cell: (row) => fpLabel(rightValue(row)),
    },
    {
      id: "starters",
      header: "Starters",
      sortable: true,
      numeric: true,
      defaultSortDirection: "desc",
      sortValue: (row) => row.starters,
      cell: (row) => fpLabel(row.starters),
    },
    {
      id: "espn",
      header: "ESPN team pts",
      sortable: true,
      numeric: true,
      defaultSortDirection: "desc",
      sortValue: (row) => row.espn_points,
      cell: (row) => fpLabel(row.espn_points),
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowKey={(row) => `split-${row.team_id}`}
      searchText={(row) => row.name}
      searchPlaceholder="Search teams…"
      pageSize={25}
      emptyMessage="No split totals in this analysis snapshot."
      initialSort={{ columnId: "starters", direction: "desc" }}
    />
  );
}

function SeasonPointsChart({
  model,
}: {
  model: NonNullable<ReturnType<typeof buildChartModel>>;
}) {
  const width = 720;
  const height = 280;
  const padL = 48;
  const padR = 12;
  const padT = 12;
  const padB = 36;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  return (
    <div className="season-points-chart panel">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Season points by team"
        className="season-points-chart-svg"
      >
        {model.yTicks.map((tick) => {
          const y = padT + innerH - (tick / model.yMax) * innerH;
          return (
            <g key={`y-${tick}`}>
              <line
                x1={padL}
                x2={padL + innerW}
                y1={y}
                y2={y}
                className="season-points-grid"
              />
              <text x={padL - 8} y={y + 4} textAnchor="end" className="season-points-axis">
                {Math.round(tick)}
              </text>
            </g>
          );
        })}
        {model.xTicks.map((tick) => {
          const x = padL + tick.x * innerW;
          return (
            <text
              key={`x-${tick.label}-${tick.x}`}
              x={x}
              y={height - 8}
              textAnchor="middle"
              className="season-points-axis"
            >
              {tick.label}
            </text>
          );
        })}
        {model.lines.map((line) => (
          <path
            key={line.teamId}
            d={linePath(line.points, innerW, innerH, model.yMax)}
            transform={`translate(${padL}, ${padT})`}
            fill="none"
            stroke={line.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </svg>
      <ul className="season-points-legend">
        {model.lines.map((line) => (
          <li key={line.teamId}>
            <span
              className="season-points-swatch"
              style={{ background: line.color }}
            />
            {line.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BaseballAnalysisPanel({
  league,
  analysis,
  seriesMode,
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  analysis: BaseballAnalysisSnapshot | null;
  seriesMode: AnalysisSeriesMode;
  viewerTeamId?: number;
}) {
  if (!isSeasonPointsScoring(league.scoring_type)) {
    return (
      <EmptyState title="Analysis is for Season Points leagues">
        Slot totals and the season-points chart need ESPN{" "}
        <code>TOTAL_SEASON_POINTS</code>. H2H category leagues stay on the
        Category Board and period boxes — the hub will not invent fantasy
        points.
      </EmptyState>
    );
  }

  const isHockey = league.sport === "hockey";
  const rows = slotTableRows(analysis?.slotPoints ?? null);
  const columns = slotColumnsFor(analysis?.slotPoints ?? null, league.sport);
  const chart = buildChartModel(analysis?.timeseries ?? null, seriesMode);
  const periods = analysis?.slotPoints?.periods;
  const method = analysis?.slotPoints?.method;

  if (!rows.length) {
    return (
      <EmptyState title="No analysis snapshot for this season">
        Run <code>sj sync</code> or <code>sj analysis</code> with ESPN cookies
        to walk daily <code>mRoster</code> and write{" "}
        <code>analysis/slot_points.json</code>. The hub does not call ESPN
        from this page.
      </EmptyState>
    );
  }

  return (
    <div className="baseball-analysis">
      <h3 className="roster-group-title" style={{ marginTop: 0 }}>
        Analysis
      </h3>
      <p className="lede">
        Daily starter fantasy points by lineup slot. Each scoring period
        credits that day&apos;s ESPN <code>appliedTotal</code> to the slot the
        player occupied — not season-to-date <code>appliedStatTotal</code>.
        Projection-free snapshot arithmetic.
      </p>
      <p className="league-meta">
        {periods?.ok
          ? `${periods.ok} scoring periods`
          : "Scoring periods unknown"}
        {periods?.first != null && periods?.latest != null
          ? ` · ${periods.first}–${periods.latest}`
          : ""}
        {periods?.failed?.length
          ? ` · ${periods.failed.length} period${periods.failed.length === 1 ? "" : "s"} failed`
          : ""}
        {method ? ` · ${method}` : ""}
        . Starter sum should land within ~1% of ESPN team points; leftover is
        bench/IR unused production plus missing days
        {isHockey ? "." : " or pitcher caps."}
      </p>

      <section style={{ marginTop: "1rem" }}>
        <h3 className="roster-group-title">Points by lineup slot</h3>
        <SlotTable
          league={league}
          rows={rows}
          columns={columns}
          viewerTeamId={viewerTeamId}
        />
      </section>

      <section style={{ marginTop: "1.25rem" }}>
        <h3 className="roster-group-title">
          {isHockey ? "Skaters vs goalies" : "Batters vs pitchers"}
        </h3>
        <p className="league-meta">
          {isHockey
            ? "Skaters = Forward+Defense+Util. Goalies = Goalie. Starters and ESPN team points stay on the row for comparison."
            : "Bats = C+1B+2B+3B+SS+OF+DH+UTIL. Pitchers = P+RP. Starters and ESPN team points stay on the row for comparison."}
        </p>
        <SplitTable
          league={league}
          rows={rows}
          viewerTeamId={viewerTeamId}
          isHockey={isHockey}
        />
      </section>

      <section style={{ marginTop: "1.25rem" }}>
        <h3 className="roster-group-title">Season points</h3>
        <p className="league-meta">
          One line per team. X-axis is the ESPN scoring period (calendar day
          of the {isHockey ? "NHL" : "MLB"} season). Cumulative starter points
          is the default.
        </p>
        <SeriesSwitcher
          leagueId={league.league_id}
          season={league.season}
          mode={seriesMode}
        />
        {chart ? (
          <SeasonPointsChart model={chart} />
        ) : (
          <EmptyState title="No timeseries in this snapshot">
            Slot totals loaded, but{" "}
            <code>analysis/points_timeseries.json</code> is missing. Re-run{" "}
            <code>sj analysis</code> for this season.
          </EmptyState>
        )}
      </section>
    </div>
  );
}
