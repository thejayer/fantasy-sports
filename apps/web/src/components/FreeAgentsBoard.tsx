"use client";

import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import type { Player } from "@/lib/data";
import {
  formatHeight,
  formatMinutes,
  formatWhole,
  teamLabel,
  toiTitle,
  type HockeyBioIndex,
} from "@/lib/hockey-nhl";

/** Age / Ht / Wt / Team / EV / PP from the synced NHL sidecars (HOCKEY-PORT H1). */
function hockeyColumns(bios: HockeyBioIndex): DataTableColumn<Player>[] {
  const bio = (row: Player) => (row.id != null ? bios[String(row.id)] : undefined);
  return [
    {
      id: "age",
      header: "Age",
      sortable: true,
      numeric: true,
      sortValue: (row) => bio(row)?.age ?? null,
      cell: (row) => formatWhole(bio(row)?.age),
    },
    {
      id: "height",
      header: "Ht",
      sortable: true,
      numeric: true,
      defaultSortDirection: "desc",
      sortValue: (row) => bio(row)?.heightIn ?? null,
      cell: (row) => formatHeight(bio(row)?.heightIn),
    },
    {
      id: "weight",
      header: "Wt",
      sortable: true,
      numeric: true,
      defaultSortDirection: "desc",
      sortValue: (row) => bio(row)?.weightLb ?? null,
      cell: (row) => formatWhole(bio(row)?.weightLb),
    },
    {
      id: "nhl_team",
      header: "Team",
      sortable: true,
      sortValue: (row) => bio(row)?.team ?? null,
      cell: (row) => {
        const label = teamLabel(bio(row));
        return <span title={label.title}>{label.text}</span>;
      },
    },
    {
      id: "ev_min",
      header: "EV min",
      sortable: true,
      numeric: true,
      defaultSortDirection: "desc",
      sortValue: (row) => bio(row)?.evMin ?? null,
      cell: (row) => (
        <span title={toiTitle(bio(row))}>{formatMinutes(bio(row)?.evMin)}</span>
      ),
    },
    {
      id: "pp_min",
      header: "PP min",
      sortable: true,
      numeric: true,
      defaultSortDirection: "desc",
      sortValue: (row) => bio(row)?.ppMin ?? null,
      cell: (row) => (
        <span title={toiTitle(bio(row))}>{formatMinutes(bio(row)?.ppMin)}</span>
      ),
    },
  ];
}

function columns(sport: string, bios?: HockeyBioIndex): DataTableColumn<Player>[] {
  const teamHeader =
    sport === "baseball" ? "MLB" : sport === "hockey" ? "NHL" : "NFL";
  return [
    {
      id: "position",
      header: "Pos",
      sortable: true,
      filterable: true,
      filterValue: (row) => row.position,
      sortValue: (row) => row.position,
      cell: (row) => row.position ?? "—",
    },
    {
      id: "name",
      header: "Player",
      sortable: true,
      sortValue: (row) => row.name,
      cell: (row) => row.name ?? "—",
    },
    {
      id: "pro_team",
      header: teamHeader,
      sortable: true,
      sortValue: (row) => row.pro_team,
      cell: (row) => row.pro_team ?? "—",
    },
    ...(sport === "hockey" && bios ? hockeyColumns(bios) : []),
    {
      id: "status",
      header: "Status",
      sortable: true,
      filterable: true,
      filterValue: (row) => row.status,
      sortValue: (row) => row.status,
      cell: (row) => row.status ?? "—",
    },
    {
      id: "percent_owned",
      header: "% Own",
      sortable: true,
      defaultSortDirection: "desc",
      numeric: true,
      sortValue: (row) => row.percent_owned,
      cell: (row) =>
        row.percent_owned == null ? "—" : row.percent_owned.toFixed(1),
    },
    {
      id: "avg_points",
      header: "Avg",
      sortable: true,
      defaultSortDirection: "desc",
      numeric: true,
      sortValue: (row) => row.avg_points,
      cell: (row) =>
        row.avg_points == null ? "—" : row.avg_points.toFixed(1),
    },
    {
      id: "total_points",
      header: "Total",
      sortable: true,
      defaultSortDirection: "desc",
      numeric: true,
      sortValue: (row) => row.total_points,
      cell: (row) =>
        row.total_points == null ? "—" : row.total_points.toFixed(1),
    },
  ];
}

/** Projection-free ESPN free-agent board (baseball Waivers tab; football uses Tools). */
export function FreeAgentsBoard({
  agents,
  sport,
  hockeyBios,
}: {
  agents: Player[];
  sport: string;
  /** ESPN id → NHL bio (hockey only; from `nhl/` sidecars, sliced to these agents). */
  hockeyBios?: HockeyBioIndex;
}) {
  if (!agents.length) {
    return (
      <EmptyState title="No free agents in this snapshot">
        Sync wrote an empty ESPN free-agent pool (pre-2019 seasons, or ESPN
        returned none). Re-run <code>sj sync</code> for the current season —
        size-capped by <code>SJ_FREE_AGENT_SIZE</code>.
      </EmptyState>
    );
  }

  return (
    <div className="free-agents-board" style={{ marginTop: "0.75rem" }}>
      <p className="lede">
        ESPN free agents / waivers ({agents.length} players, size-capped at
        sync). Projection-free board — football members who want VOR joins use
        Tools → Waivers.
      </p>
      <DataTable
        rows={agents}
        columns={columns(sport, hockeyBios)}
        getRowKey={(row) => String(row.id ?? row.name ?? "fa")}
        searchPlaceholder="Search free agents…"
        searchText={(row) =>
          [row.name, row.position, row.pro_team, row.status]
            .filter(Boolean)
            .join(" ")
        }
        pageSize={25}
        emptyMessage="No free agents match this search or filter."
        initialSort={{ columnId: "percent_owned", direction: "desc" }}
      />
    </div>
  );
}
