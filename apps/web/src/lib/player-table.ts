/**
 * Server-side players board query (roadmap 7.11).
 *
 * Client DataTable used to receive every row so 25 could render — that serialized
 * the full board into the RSC/HTML payload. Search / sort / page now live on
 * searchParams; only the current page of slim rows is rendered.
 */

import { isPitcher, stat } from "@/lib/baseball";
import type { Player } from "@/lib/data";
import {
  compareSortValues,
  normalizeSearch,
  paginateRows,
  type SortDirection,
} from "@/lib/table";
import type { PlayerWithProjection } from "@/lib/projection-join";

export const PLAYER_TABLE_PAGE_SIZE = 25;

/** Flat row with only the fields the board displays or sorts on. */
export type SlimPlayerRow = {
  id: string | number | null;
  name: string | null;
  position: string | null;
  pro_team: string | null;
  fantasy_team: string | null;
  injury_status: string | null;
  status: string | null;
  total_points: number | null;
  role: string | null;
  /** Baseball counting / rate stats used as columns. */
  R: number | null;
  HR: number | null;
  RBI: number | null;
  SB: number | null;
  AVG: number | null;
  OPS: number | null;
  IP: number | null;
  W: number | null;
  SV: number | null;
  K: number | null;
  ERA: number | null;
  WHIP: number | null;
  /** Football projection quantiles when joined. */
  floor: number | null;
  median: number | null;
  ceiling: number | null;
  vor: number | null;
};

export type PlayerTableQuery = {
  q: string;
  pos: string | null;
  sort: string;
  dir: SortDirection;
  page: number;
};

export function parsePlayerTableQuery(input: {
  q?: string;
  pos?: string;
  sort?: string;
  dir?: string;
  p?: string;
  /** Default sort column when the URL omits one. */
  defaultSort?: string;
}): PlayerTableQuery {
  const dir = input.dir === "asc" || input.dir === "desc" ? input.dir : "desc";
  const page = Math.max(1, Number.parseInt(input.p ?? "1", 10) || 1);
  return {
    q: (input.q ?? "").trim(),
    pos: input.pos?.trim() || null,
    sort: (input.sort ?? input.defaultSort ?? "fpts").trim() || "fpts",
    dir,
    page,
  };
}

export function slimPlayerRow(
  player: Player | PlayerWithProjection,
): SlimPlayerRow {
  const projection =
    "projection" in player ? (player.projection ?? null) : null;
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    pro_team: player.pro_team,
    fantasy_team: player.fantasy_team ?? null,
    injury_status: player.injury_status,
    status: player.status ?? null,
    total_points: player.total_points,
    role: player.role ?? (isPitcher(player) ? "pitcher" : "batter"),
    R: stat(player, "R"),
    HR: stat(player, "HR"),
    RBI: stat(player, "RBI"),
    SB: stat(player, "SB"),
    AVG: stat(player, "AVG"),
    OPS: stat(player, "OPS"),
    IP: stat(player, "IP"),
    W: stat(player, "W"),
    SV: stat(player, "SV"),
    K: stat(player, "K"),
    ERA: stat(player, "ERA"),
    WHIP: stat(player, "WHIP"),
    floor: projection?.floor ?? null,
    median: projection?.median ?? null,
    ceiling: projection?.ceiling ?? null,
    vor: projection?.vor ?? null,
  };
}

function sortValue(row: SlimPlayerRow, columnId: string): string | number | null {
  switch (columnId) {
    case "name":
      return row.name;
    case "position":
      return row.position;
    case "pro_team":
      return row.pro_team;
    case "fantasy_team":
      return row.fantasy_team;
    case "fpts":
      return row.total_points;
    case "floor":
      return row.floor;
    case "median":
      return row.median;
    case "ceiling":
      return row.ceiling;
    case "vor":
      return row.vor;
    case "R":
    case "HR":
    case "RBI":
    case "SB":
    case "AVG":
    case "OPS":
    case "IP":
    case "W":
    case "SV":
    case "K":
    case "ERA":
    case "WHIP":
      return row[columnId];
    default:
      return row.total_points;
  }
}

export function filterSlimPlayerRows(
  rows: SlimPlayerRow[],
  query: Pick<PlayerTableQuery, "q" | "pos">,
): SlimPlayerRow[] {
  const needle = normalizeSearch(query.q);
  return rows.filter((row) => {
    if (query.pos && row.position !== query.pos) return false;
    if (!needle) return true;
    const hay = normalizeSearch(
      [row.name, row.position, row.pro_team, row.fantasy_team]
        .filter(Boolean)
        .join(" "),
    );
    return hay.includes(needle);
  });
}

export function sortSlimPlayerRows(
  rows: SlimPlayerRow[],
  sort: string,
  dir: SortDirection,
): SlimPlayerRow[] {
  const copy = [...rows];
  copy.sort((a, b) =>
    compareSortValues(sortValue(a, sort), sortValue(b, sort), dir),
  );
  return copy;
}

export function uniquePositions(rows: SlimPlayerRow[]): string[] {
  return [
    ...new Set(rows.map((r) => r.position).filter((p): p is string => Boolean(p))),
  ].sort((a, b) => a.localeCompare(b));
}

export type PlayerTableResult = {
  rows: SlimPlayerRow[];
  filteredCount: number;
  totalCount: number;
  pageCount: number;
  page: number;
  positions: string[];
};

export function queryPlayerTable(
  players: Array<Player | PlayerWithProjection>,
  query: PlayerTableQuery,
  pageSize = PLAYER_TABLE_PAGE_SIZE,
): PlayerTableResult {
  const slim = players.map(slimPlayerRow);
  const positions = uniquePositions(slim);
  const filtered = filterSlimPlayerRows(slim, query);
  const sorted = sortSlimPlayerRows(filtered, query.sort, query.dir);
  const { pageRows, pageCount, safePage } = paginateRows(
    sorted,
    query.page,
    pageSize,
  );
  return {
    rows: pageRows,
    filteredCount: filtered.length,
    totalCount: slim.length,
    pageCount,
    page: safePage,
    positions,
  };
}

/** Build a players-tab href preserving league chrome. */
export function playersTableHref(
  leagueId: string,
  season: number,
  base: {
    role?: string;
    q?: string;
    pos?: string | null;
    sort?: string;
    dir?: SortDirection;
    page?: number;
  },
): string {
  const params = new URLSearchParams({
    season: String(season),
    tab: "players",
  });
  if (base.role && base.role !== "all") params.set("role", base.role);
  if (base.q) params.set("q", base.q);
  if (base.pos) params.set("pos", base.pos);
  if (base.sort) params.set("sort", base.sort);
  if (base.dir) params.set("dir", base.dir);
  if (base.page != null && base.page > 1) params.set("p", String(base.page));
  return `/leagues/${leagueId}?${params.toString()}`;
}
