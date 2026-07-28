"use client";

import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import type { WaiverBoardData, WaiverRow } from "@/lib/decision-tools";
import { formatProjectionPoints } from "@/lib/projection-join";

function columns(): DataTableColumn<WaiverRow>[] {
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
      id: "player_name",
      header: "Player",
      sortable: true,
      sortValue: (row) => row.player_name,
      cell: (row) => row.player_name ?? row.player_id,
    },
    {
      id: "team",
      header: "NFL",
      sortable: true,
      sortValue: (row) => row.team,
      cell: (row) => row.team ?? "—",
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
      id: "floor",
      header: "Floor",
      sortable: true,
      defaultSortDirection: "desc",
      numeric: true,
      sortValue: (row) => row.floor,
      cell: (row) => formatProjectionPoints(row.floor),
    },
    {
      id: "median",
      header: "Median",
      sortable: true,
      defaultSortDirection: "desc",
      numeric: true,
      sortValue: (row) => row.median,
      cell: (row) => formatProjectionPoints(row.median),
    },
    {
      id: "ceiling",
      header: "Ceiling",
      sortable: true,
      defaultSortDirection: "desc",
      numeric: true,
      sortValue: (row) => row.ceiling,
      cell: (row) => formatProjectionPoints(row.ceiling),
    },
    {
      id: "vor",
      header: "VOR",
      sortable: true,
      defaultSortDirection: "desc",
      numeric: true,
      sortValue: (row) => row.vor,
      cell: (row) => formatProjectionPoints(row.vor),
    },
  ];
}

export function WaiverBoard({ board }: { board: WaiverBoardData }) {
  const { rows, source } = board;

  if (!rows.length) {
    if (source === "espn") {
      return (
        <EmptyState title="No free agents in this snapshot">
          Sync wrote an empty ESPN free-agent pool (pre-2019 seasons, or ESPN
          returned none for this week). Re-run <code>sj sync</code> for the
          current season to refresh.
        </EmptyState>
      );
    }
    return (
      <EmptyState title="No unrostered projections to rank">
        This board falls back to engine players not on any roster when the
        season has no synced ESPN free agents. With synthetic fixture ESPN ids,
        almost everyone looks unrostered; use live sync + player map for a real
        wire.
      </EmptyState>
    );
  }

  const lede =
    source === "espn"
      ? `ESPN free agents / waivers (${rows.length} players, size-capped at sync). Season projection quantiles join through the player map when available; unmapped rows still show % owned.`
      : `Unrostered season projections ranked by VOR (${rows.length} players). Fallback used because this snapshot has no ESPN free_agents list — re-sync the current season to load the wire.`;

  return (
    <div className="waiver-board">
      <p className="lede" style={{ marginTop: "0.75rem" }}>
        {lede}
      </p>
      <DataTable
        rows={rows}
        columns={columns()}
        getRowKey={(row) => row.espn_id ?? row.player_id}
        searchPlaceholder={
          source === "espn" ? "Search free agents…" : "Search waiver proxies…"
        }
        searchText={(row) =>
          [row.player_name, row.position, row.team].filter(Boolean).join(" ")
        }
        pageSize={25}
        emptyMessage="No players match this search or filter."
        initialSort={
          source === "espn"
            ? { columnId: "percent_owned", direction: "desc" }
            : { columnId: "vor", direction: "desc" }
        }
      />
    </div>
  );
}
