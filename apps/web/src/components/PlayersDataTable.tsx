"use client";

import { DataTable, type DataTableColumn } from "@/components/DataTable";
import type { Player } from "@/lib/data";
import { formatStat, isPitcher, stat } from "@/lib/baseball";
import { injuryTone } from "@/lib/league";
import {
  formatProjectionPoints,
  type PlayerWithProjection,
} from "@/lib/projection-join";

function StatusDot({ player }: { player: Player }) {
  const tone = injuryTone(player);
  const label = player.injury_status || player.status || "OK";
  return <span className={`status-dot ${tone}`} title={label} />;
}

function dashWhen(
  hide: boolean,
  value: string,
): string {
  return hide ? "—" : value;
}

function footballColumns(
  showProjections: boolean,
): DataTableColumn<PlayerWithProjection>[] {
  const columns: DataTableColumn<PlayerWithProjection>[] = [
    {
      id: "status",
      header: "",
      narrow: true,
      cell: (player) => <StatusDot player={player} />,
    },
    {
      id: "name",
      header: "Player",
      sortable: true,
      defaultSortDirection: "asc",
      sortValue: (player) => player.name,
      cell: (player) => player.name,
    },
    {
      id: "position",
      header: "Pos",
      sortable: true,
      defaultSortDirection: "asc",
      filterable: true,
      filterValue: (player) => player.position,
      sortValue: (player) => player.position,
      cell: (player) => player.position ?? "—",
    },
    {
      id: "pro_team",
      header: "Pro",
      sortable: true,
      defaultSortDirection: "asc",
      sortValue: (player) => player.pro_team,
      cell: (player) => player.pro_team ?? "—",
    },
    {
      id: "fantasy_team",
      header: "Fantasy",
      sortable: true,
      defaultSortDirection: "asc",
      sortValue: (player) => player.fantasy_team,
      cell: (player) => player.fantasy_team ?? "—",
    },
    {
      id: "fpts",
      header: "FPts",
      sortable: true,
      defaultSortDirection: "desc",
      numeric: true,
      sortValue: (player) => player.total_points,
      cell: (player) => player.total_points?.toFixed?.(1) ?? "—",
    },
  ];
  if (showProjections) {
    columns.push(
      {
        id: "floor",
        header: "Floor",
        sortable: true,
        defaultSortDirection: "desc",
        numeric: true,
        sortValue: (player) => player.projection?.floor,
        cell: (player) => formatProjectionPoints(player.projection?.floor),
      },
      {
        id: "median",
        header: "Med",
        sortable: true,
        defaultSortDirection: "desc",
        numeric: true,
        sortValue: (player) => player.projection?.median,
        cell: (player) => formatProjectionPoints(player.projection?.median),
      },
      {
        id: "ceiling",
        header: "Ceil",
        sortable: true,
        defaultSortDirection: "desc",
        numeric: true,
        sortValue: (player) => player.projection?.ceiling,
        cell: (player) => formatProjectionPoints(player.projection?.ceiling),
      },
      {
        id: "vor",
        header: "VOR",
        sortable: true,
        defaultSortDirection: "desc",
        numeric: true,
        sortValue: (player) => player.projection?.vor,
        cell: (player) => formatProjectionPoints(player.projection?.vor),
      },
    );
  }
  return columns;
}

function baseballColumns(role: string): DataTableColumn<Player>[] {
  const columns: DataTableColumn<Player>[] = [
    {
      id: "status",
      header: "",
      narrow: true,
      cell: (player) => <StatusDot player={player} />,
    },
    {
      id: "name",
      header: "Player",
      sortable: true,
      defaultSortDirection: "asc",
      sortValue: (player) => player.name,
      cell: (player) => player.name,
    },
    {
      id: "position",
      header: "Pos",
      sortable: true,
      defaultSortDirection: "asc",
      filterable: true,
      filterValue: (player) => player.position,
      sortValue: (player) => player.position,
      cell: (player) => player.position ?? "—",
    },
    {
      id: "pro_team",
      header: "Team",
      sortable: true,
      defaultSortDirection: "asc",
      sortValue: (player) => player.pro_team,
      cell: (player) => player.pro_team ?? "—",
    },
    {
      id: "fantasy_team",
      header: "Fantasy",
      sortable: true,
      defaultSortDirection: "asc",
      sortValue: (player) => player.fantasy_team,
      cell: (player) => player.fantasy_team ?? "—",
    },
  ];

  if (role !== "pitcher") {
    columns.push(
      {
        id: "R",
        header: "R",
        sortable: true,
        numeric: true,
        sortValue: (player) =>
          isPitcher(player) && role === "all" ? null : stat(player, "R"),
        cell: (player) =>
          dashWhen(
            isPitcher(player) && role === "all",
            formatStat(stat(player, "R")),
          ),
      },
      {
        id: "HR",
        header: "HR",
        sortable: true,
        numeric: true,
        sortValue: (player) =>
          isPitcher(player) && role === "all" ? null : stat(player, "HR"),
        cell: (player) =>
          dashWhen(
            isPitcher(player) && role === "all",
            formatStat(stat(player, "HR")),
          ),
      },
      {
        id: "RBI",
        header: "RBI",
        sortable: true,
        numeric: true,
        sortValue: (player) =>
          isPitcher(player) && role === "all" ? null : stat(player, "RBI"),
        cell: (player) =>
          dashWhen(
            isPitcher(player) && role === "all",
            formatStat(stat(player, "RBI")),
          ),
      },
      {
        id: "SB",
        header: "SB",
        sortable: true,
        numeric: true,
        sortValue: (player) =>
          isPitcher(player) && role === "all" ? null : stat(player, "SB"),
        cell: (player) =>
          dashWhen(
            isPitcher(player) && role === "all",
            formatStat(stat(player, "SB")),
          ),
      },
      {
        id: "AVG",
        header: "AVG",
        sortable: true,
        numeric: true,
        sortValue: (player) =>
          isPitcher(player) && role === "all" ? null : stat(player, "AVG"),
        cell: (player) =>
          dashWhen(
            isPitcher(player) && role === "all",
            formatStat(stat(player, "AVG"), 3),
          ),
      },
      {
        id: "OPS",
        header: "OPS",
        sortable: true,
        numeric: true,
        sortValue: (player) =>
          isPitcher(player) && role === "all" ? null : stat(player, "OPS"),
        cell: (player) =>
          dashWhen(
            isPitcher(player) && role === "all",
            formatStat(stat(player, "OPS"), 3),
          ),
      },
    );
  }

  if (role !== "batter") {
    columns.push(
      {
        id: "IP",
        header: "IP",
        sortable: true,
        numeric: true,
        sortValue: (player) =>
          !isPitcher(player) && role === "all" ? null : stat(player, "IP"),
        cell: (player) =>
          dashWhen(
            !isPitcher(player) && role === "all",
            formatStat(stat(player, "IP"), 1),
          ),
      },
      {
        id: "W",
        header: "W",
        sortable: true,
        numeric: true,
        sortValue: (player) =>
          !isPitcher(player) && role === "all" ? null : stat(player, "W"),
        cell: (player) =>
          dashWhen(
            !isPitcher(player) && role === "all",
            formatStat(stat(player, "W")),
          ),
      },
      {
        id: "SV",
        header: "SV",
        sortable: true,
        numeric: true,
        sortValue: (player) =>
          !isPitcher(player) && role === "all" ? null : stat(player, "SV"),
        cell: (player) =>
          dashWhen(
            !isPitcher(player) && role === "all",
            formatStat(stat(player, "SV")),
          ),
      },
      {
        id: "K",
        header: "K",
        sortable: true,
        numeric: true,
        sortValue: (player) =>
          !isPitcher(player) && role === "all" ? null : stat(player, "K"),
        cell: (player) =>
          dashWhen(
            !isPitcher(player) && role === "all",
            formatStat(stat(player, "K")),
          ),
      },
      {
        id: "ERA",
        header: "ERA",
        sortable: true,
        numeric: true,
        sortValue: (player) =>
          !isPitcher(player) && role === "all" ? null : stat(player, "ERA"),
        cell: (player) =>
          dashWhen(
            !isPitcher(player) && role === "all",
            formatStat(stat(player, "ERA"), 2),
          ),
      },
      {
        id: "WHIP",
        header: "WHIP",
        sortable: true,
        numeric: true,
        sortValue: (player) =>
          !isPitcher(player) && role === "all" ? null : stat(player, "WHIP"),
        cell: (player) =>
          dashWhen(
            !isPitcher(player) && role === "all",
            formatStat(stat(player, "WHIP"), 2),
          ),
      },
    );
  }

  columns.push({
    id: "fpts",
    header: "FPts",
    sortable: true,
    defaultSortDirection: "desc",
    numeric: true,
    sortValue: (player) => player.total_points,
    cell: (player) => player.total_points?.toFixed?.(1) ?? "—",
  });

  return columns;
}

export function PlayersDataTable({
  players,
  sport,
  role = "all",
  showProjections = false,
}: {
  players: Player[] | PlayerWithProjection[];
  sport: string;
  role?: string;
  /** Season floor/med/ceil/VOR from ffa snapshots (roadmap 4.4). */
  showProjections?: boolean;
}) {
  if (sport === "baseball") {
    return (
      <DataTable
        rows={players}
        columns={baseballColumns(role)}
        getRowKey={(player) => `${player.id}-${player.name}`}
        searchPlaceholder="Search players…"
        searchText={(player) =>
          [player.name, player.position, player.pro_team, player.fantasy_team]
            .filter(Boolean)
            .join(" ")
        }
        pageSize={25}
        emptyMessage="No players match this search or filter."
        initialSort={{ columnId: "fpts", direction: "desc" }}
      />
    );
  }

  const rows: PlayerWithProjection[] = players.map((player) => ({
    ...player,
    projection: "projection" in player ? (player.projection ?? null) : null,
  }));

  return (
    <DataTable
      rows={rows}
      columns={footballColumns(showProjections)}
      getRowKey={(player) => `${player.id}-${player.name}`}
      searchPlaceholder="Search players…"
      searchText={(player) =>
        [player.name, player.position, player.pro_team, player.fantasy_team]
          .filter(Boolean)
          .join(" ")
      }
      pageSize={25}
      emptyMessage="No players match this search or filter."
      initialSort={{
        columnId: showProjections ? "vor" : "fpts",
        direction: "desc",
      }}
    />
  );
}
