"use client";

import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import type { ProjectionPlayer } from "@/lib/data";
import { formatProjectionPoints } from "@/lib/projection-join";

function columns(): DataTableColumn<ProjectionPlayer>[] {
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

export function WaiverBoard({ players }: { players: ProjectionPlayer[] }) {
  if (!players.length) {
    return (
      <EmptyState title="No unrostered projections to rank">
        This board lists engine players not on any roster in the snapshot —
        a waiver proxy until ESPN free agents are synced (roadmap 2.4). With
        synthetic fixture ESPN ids, almost everyone looks unrostered; use live
        sync + player map for a real wire.
      </EmptyState>
    );
  }

  return (
    <div className="waiver-board">
      <p className="lede" style={{ marginTop: "0.75rem" }}>
        Unrostered season projections ranked by VOR ({players.length} players).
        Not ESPN free agents — rostered GSIS ids are subtracted via the player
        map.
      </p>
      <DataTable
        rows={players}
        columns={columns()}
        getRowKey={(row) => row.player_id}
        searchPlaceholder="Search waiver proxies…"
        searchText={(row) =>
          [row.player_name, row.position, row.team].filter(Boolean).join(" ")
        }
        pageSize={25}
        emptyMessage="No players match this search or filter."
        initialSort={{ columnId: "vor", direction: "desc" }}
      />
    </div>
  );
}
