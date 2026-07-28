"use client";

import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import type { ProjectionPlayer, ProjectionSnapshot } from "@/lib/data";
import { formatProjectionPoints } from "@/lib/projection-join";

function columns(): DataTableColumn<ProjectionPlayer>[] {
  return [
    {
      id: "tier",
      header: "Tier",
      sortable: true,
      defaultSortDirection: "asc",
      numeric: true,
      narrow: true,
      sortValue: (row) => row.tier,
      cell: (row) => (row.tier != null ? String(row.tier) : "—"),
    },
    {
      id: "position",
      header: "Pos",
      sortable: true,
      defaultSortDirection: "asc",
      filterable: true,
      filterValue: (row) => row.position,
      sortValue: (row) => row.position,
      cell: (row) => row.position ?? "—",
    },
    {
      id: "player_name",
      header: "Player",
      sortable: true,
      defaultSortDirection: "asc",
      sortValue: (row) => row.player_name,
      cell: (row) => row.player_name ?? row.player_id,
    },
    {
      id: "team",
      header: "Team",
      sortable: true,
      defaultSortDirection: "asc",
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

export function ProjectionsBoard({
  snapshot,
}: {
  snapshot: ProjectionSnapshot | null;
}) {
  if (!snapshot?.players?.length) {
    return (
      <EmptyState title="No projection snapshot for this league">
        Season projections appear after <code>ffa export-projections</code>{" "}
        writes <code>projections/&#123;scoring&#125;/&#123;season&#125;.json</code> into
        the hub store. These are season totals (floor / median / ceiling), not
        weekly start/sit.
      </EmptyState>
    );
  }

  const generated = snapshot.generated_at
    ? new Date(snapshot.generated_at).toLocaleString()
    : null;

  return (
    <div className="projections-board">
      <p className="lede" style={{ marginTop: "0.75rem" }}>
        Season projections · {snapshot.scoring.toUpperCase()} · {snapshot.n_sims}{" "}
        sims · NFL {snapshot.season}
        {generated ? ` · generated ${generated}` : ""}. Floor / median / ceiling
        are posterior quantiles — not week-to-week start/sit.
      </p>
      <DataTable
        rows={snapshot.players}
        columns={columns()}
        getRowKey={(row) => row.player_id}
        searchPlaceholder="Search projected players…"
        searchText={(row) =>
          [row.player_name, row.position, row.team].filter(Boolean).join(" ")
        }
        pageSize={40}
        emptyMessage="No projected players match this search or filter."
        initialSort={{ columnId: "vor", direction: "desc" }}
      />
    </div>
  );
}
