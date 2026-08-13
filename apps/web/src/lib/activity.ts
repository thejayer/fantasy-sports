/**
 * League activity / transactions from ESPN recent_activity (sj sync).
 * Dates arrive as ESPN-style YYYYMMDDHHmmss strings (or epoch-ish numbers).
 */

import type { LeagueSnapshot, Team, Transaction } from "@/lib/data";
import { teamNameById } from "@/lib/draft-results";

/** Feed filter chips (roadmap 7.6). Legacy activity views stay valid. */
export type ActivityView =
  | "all"
  | "trades"
  | "waivers"
  | "results"
  | "draft"
  | "talk";

export type ActivityActionRow = {
  key: string;
  dateRaw: string | number | null;
  dateLabel: string;
  sortKey: number;
  teamId: number | null;
  teamName: string;
  action: string;
  playerName: string;
  playerId: number | null;
  bidAmount: number;
  kind: "trade" | "waiver" | "other";
};

export function classifyAction(action: string | null | undefined): ActivityActionRow["kind"] {
  const text = (action ?? "").toUpperCase();
  if (text.includes("TRADE")) return "trade";
  if (
    text.includes("FA ") ||
    text.includes("WAIVER") ||
    text.includes("DROP") ||
    text.includes("ADD")
  ) {
    return "waiver";
  }
  return "other";
}

/** ESPN `DROPPED` / `WAIVER DROPPED` (and any other DROP* action string). */
export function isDropAction(action: string | null | undefined): boolean {
  return (action ?? "").toUpperCase().includes("DROP");
}

/** One unique player a franchise dropped this season (roadmap 7.4). */
export type DroppedPlayerSummary = {
  key: string;
  playerId: number | null;
  playerName: string;
  dropCount: number;
  lastDateLabel: string;
  lastSortKey: number;
};

/** Parse ESPN `YYYYMMDDHHmmss` (or shorter date prefixes) into a Date. */
export function parseEspnActivityDate(
  value: string | number | null | undefined,
): Date | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // Heuristic: ms vs seconds vs YYYYMMDD
    if (value > 1e12) return new Date(value);
    if (value > 1e9) return new Date(value * 1000);
    const asStr = String(Math.trunc(value));
    return parseEspnActivityDate(asStr);
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const hour = digits.length >= 10 ? Number(digits.slice(8, 10)) : 0;
  const minute = digits.length >= 12 ? Number(digits.slice(10, 12)) : 0;
  const second = digits.length >= 14 ? Number(digits.slice(12, 14)) : 0;
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatActivityDate(
  value: string | number | null | undefined,
): string {
  const date = parseEspnActivityDate(value);
  if (!date) return value == null || value === "" ? "—" : String(value);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function activitySortKey(
  value: string | number | null | undefined,
): number {
  const date = parseEspnActivityDate(value);
  return date ? date.getTime() : 0;
}

export function flattenTransactions(
  transactions: Transaction[] | null | undefined,
  teams: Team[],
): ActivityActionRow[] {
  const names = teamNameById(teams);
  const rows: ActivityActionRow[] = [];
  (transactions ?? []).forEach((tx, txIndex) => {
    const actions = tx.actions ?? [];
    actions.forEach((action, actionIndex) => {
      const kind = classifyAction(action.action);
      rows.push({
        key: `${txIndex}-${actionIndex}-${action.player_id ?? "x"}-${action.action}`,
        dateRaw: tx.date,
        dateLabel: formatActivityDate(tx.date),
        sortKey: activitySortKey(tx.date),
        teamId: action.team_id,
        teamName:
          action.team_id != null
            ? (names.get(action.team_id) ?? `Team ${action.team_id}`)
            : "—",
        action: action.action ?? "—",
        playerName: action.player_name ?? "—",
        playerId: action.player_id,
        bidAmount: action.bid_amount ?? 0,
        kind,
      });
    });
  });
  return rows.sort((a, b) => b.sortKey - a.sortKey || a.key.localeCompare(b.key));
}

/** Newest-first drop events for one franchise. */
export function droppedRowsForTeam(
  league: Pick<LeagueSnapshot, "transactions" | "teams">,
  teamId: number,
): ActivityActionRow[] {
  return flattenTransactions(league.transactions, league.teams).filter(
    (row) => row.teamId === teamId && isDropAction(row.action),
  );
}

/**
 * Unique players a manager dropped this season, newest last-drop first.
 * Same player dropped twice collapses to one row with `dropCount`.
 */
export function droppedPlayersForTeam(
  league: Pick<LeagueSnapshot, "transactions" | "teams">,
  teamId: number,
): DroppedPlayerSummary[] {
  const groups = new Map<string, DroppedPlayerSummary>();
  for (const row of droppedRowsForTeam(league, teamId)) {
    const key =
      row.playerId != null ? `id:${row.playerId}` : `name:${row.playerName}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        playerId: row.playerId,
        playerName: row.playerName,
        dropCount: 1,
        lastDateLabel: row.dateLabel,
        lastSortKey: row.sortKey,
      });
      continue;
    }
    existing.dropCount += 1;
    if (row.sortKey > existing.lastSortKey) {
      existing.lastDateLabel = row.dateLabel;
      existing.lastSortKey = row.sortKey;
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.lastSortKey - a.lastSortKey || a.playerName.localeCompare(b.playerName),
  );
}

export function filterActivityRows(
  rows: ActivityActionRow[],
  view: ActivityView,
): ActivityActionRow[] {
  if (view === "trades") return rows.filter((row) => row.kind === "trade");
  if (view === "waivers") return rows.filter((row) => row.kind === "waiver");
  // results / draft / talk are feed-level filters over system events, not
  // transaction rows — leave the flat ledger unfiltered for those callers.
  return rows;
}

export function activityRowsForLeague(
  league: Pick<LeagueSnapshot, "transactions" | "teams">,
  view: ActivityView = "all",
): ActivityActionRow[] {
  return filterActivityRows(
    flattenTransactions(league.transactions, league.teams),
    view,
  );
}
