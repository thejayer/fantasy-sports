/**
 * Hall of Shame — worst drops ranked by season fantasy points (roadmap 9.5).
 *
 * Score is the dropped player's current ESPN-applied season total
 * (`total_points` on roster / free-agent / `players` rows) — not points
 * accrued only after the cut. First DROP per team–player wins; later cuts
 * of the same pair are ignored. Claimed-after is the first later
 * `FA ADDED` / `WAIVER ADDED`. Read-only over synced `transactions.json`.
 */

import {
  activitySortKey,
  classifyAction,
  formatActivityDate,
  isAddAction,
  isDropAction,
  type ActivityActionRow,
} from "@/lib/activity";
import type { LeagueSnapshot, Player, Team, Transaction } from "@/lib/data";
import { teamNameById } from "@/lib/draft-results";

export const WORST_DROPS_LEAGUE_LIMIT = 25;

export const WORST_DROPS_DISCLAIMER =
  "Season FP is the cut player's current ESPN-applied season total (roster, free-agent, or players row) — the full season, not points after the drop. First DROPPED / WAIVER DROPPED per team–player only. Claimed after is the first later FA ADDED or WAIVER ADDED. “Same team re-added” means that franchise later added the same player. Trades are not drops. Read-only — the hub does not write ESPN.";

export type WorstDropRow = {
  key: string;
  playerId: number | null;
  playerName: string;
  seasonFp: number | null;
  dateRaw: string | number | null;
  dateLabel: string;
  sortKey: number;
  teamId: number | null;
  teamName: string;
  ownerLabel: string;
  claimedByTeamId: number | null;
  claimedByTeamName: string | null;
  claimedByOwnerLabel: string | null;
  claimedAction: string | null;
  reAddedBySameTeam: boolean;
};

export type WorstDropsTeamSection = {
  teamId: number;
  teamName: string;
  ownerLabel: string;
  rows: WorstDropRow[];
};

export type WorstDropsBoard = {
  rows: WorstDropRow[];
  leagueTop: WorstDropRow[];
  byTeam: WorstDropsTeamSection[];
  dropCount: number;
  hasTransactions: boolean;
  disclaimer: string;
};

type ChronoRow = ActivityActionRow & {
  txIndex: number;
  actionIndex: number;
  seq: number;
};

function ownerLabel(team: Team | undefined): string {
  const owners = team?.owners?.filter(Boolean) ?? [];
  return owners.length ? owners.join(", ") : "—";
}

function playerIdKey(
  id: number | string | null | undefined,
): string | null {
  if (id == null || id === "") return null;
  return String(id);
}

function actionPlayerKey(row: Pick<ActivityActionRow, "playerId" | "playerName">): string {
  const id = playerIdKey(row.playerId);
  if (id) return `id:${id}`;
  return `name:${row.playerName}`;
}

function indexSeasonFp(league: LeagueSnapshot): Map<string, number | null> {
  const fp = new Map<string, number | null>();
  const touch = (player: Player) => {
    const points =
      typeof player.total_points === "number" && Number.isFinite(player.total_points)
        ? player.total_points
        : null;
    const id = playerIdKey(player.id);
    if (id) fp.set(`id:${id}`, points);
    if (player.name) fp.set(`name:${player.name}`, points);
  };
  // Roster wins over free agents over the flat players list.
  for (const player of league.players ?? []) touch(player);
  for (const player of league.free_agents ?? []) touch(player);
  for (const team of league.teams) {
    for (const player of team.roster ?? []) touch(player);
  }
  return fp;
}

function chronologicalActions(
  transactions: Transaction[] | null | undefined,
  teams: Team[],
): ChronoRow[] {
  const names = teamNameById(teams);
  const rows: ChronoRow[] = [];
  (transactions ?? []).forEach((tx, txIndex) => {
    (tx.actions ?? []).forEach((action, actionIndex) => {
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
        txIndex,
        actionIndex,
        seq: 0,
      });
    });
  });
  rows.sort((a, b) => {
    // Unparseable ESPN dates (sortKey 0) must not sort to 1970 or every
    // dated add looks like it happened after the drop. Fall back to file order.
    if (a.sortKey > 0 && b.sortKey > 0 && a.sortKey !== b.sortKey) {
      return a.sortKey - b.sortKey;
    }
    return (
      a.txIndex - b.txIndex ||
      a.actionIndex - b.actionIndex ||
      a.key.localeCompare(b.key)
    );
  });
  rows.forEach((row, index) => {
    row.seq = index;
  });
  return rows;
}

function isAfter(row: ChronoRow, drop: ChronoRow): boolean {
  return row.seq > drop.seq;
}

function compareDrops(a: WorstDropRow, b: WorstDropRow): number {
  const af = a.seasonFp;
  const bf = b.seasonFp;
  if (af == null && bf == null) {
    return a.playerName.localeCompare(b.playerName) || a.key.localeCompare(b.key);
  }
  if (af == null) return 1;
  if (bf == null) return -1;
  return bf - af || a.playerName.localeCompare(b.playerName) || a.key.localeCompare(b.key);
}

/**
 * First drop per team–player, ranked by the cut player's season FP.
 */
export function buildWorstDropsBoard(
  league: Pick<
    LeagueSnapshot,
    "transactions" | "teams" | "players" | "free_agents"
  >,
): WorstDropsBoard {
  const transactions = league.transactions ?? [];
  const hasTransactions = transactions.length > 0;
  const chrono = chronologicalActions(transactions, league.teams);
  const fpByKey = indexSeasonFp(league as LeagueSnapshot);
  const teamById = new Map(league.teams.map((team) => [team.team_id, team]));

  const firstDrops = new Map<string, ChronoRow>();
  for (const row of chrono) {
    if (!isDropAction(row.action) || row.teamId == null) continue;
    const key = `${row.teamId}:${actionPlayerKey(row)}`;
    if (!firstDrops.has(key)) firstDrops.set(key, row);
  }

  const rows: WorstDropRow[] = [];
  for (const drop of firstDrops.values()) {
    const playerKey = actionPlayerKey(drop);
    const laterAdds = chrono.filter(
      (row) =>
        isAddAction(row.action) &&
        actionPlayerKey(row) === playerKey &&
        isAfter(row, drop),
    );
    const firstAdd = laterAdds[0] ?? null;
    const reAddedBySameTeam = laterAdds.some((row) => row.teamId === drop.teamId);
    const dropTeam = drop.teamId != null ? teamById.get(drop.teamId) : undefined;
    const claimTeam =
      firstAdd?.teamId != null ? teamById.get(firstAdd.teamId) : undefined;
    rows.push({
      key: `${drop.teamId}:${playerKey}:${drop.seq}`,
      playerId: drop.playerId,
      playerName: drop.playerName,
      seasonFp: fpByKey.get(playerKey) ?? null,
      dateRaw: drop.dateRaw,
      dateLabel: drop.dateLabel,
      sortKey: drop.sortKey,
      teamId: drop.teamId,
      teamName: drop.teamName,
      ownerLabel: ownerLabel(dropTeam),
      claimedByTeamId: firstAdd?.teamId ?? null,
      claimedByTeamName: firstAdd ? firstAdd.teamName : null,
      claimedByOwnerLabel: firstAdd ? ownerLabel(claimTeam) : null,
      claimedAction: firstAdd?.action ?? null,
      reAddedBySameTeam,
    });
  }
  rows.sort(compareDrops);

  const byTeamMap = new Map<number, WorstDropsTeamSection>();
  for (const row of rows) {
    if (row.teamId == null) continue;
    const existing = byTeamMap.get(row.teamId);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    byTeamMap.set(row.teamId, {
      teamId: row.teamId,
      teamName: row.teamName,
      ownerLabel: row.ownerLabel,
      rows: [row],
    });
  }
  const byTeam = [...byTeamMap.values()].sort((a, b) => {
    const af = a.rows[0]?.seasonFp;
    const bf = b.rows[0]?.seasonFp;
    if (af == null && bf == null) return a.teamName.localeCompare(b.teamName);
    if (af == null) return 1;
    if (bf == null) return -1;
    return bf - af || a.teamName.localeCompare(b.teamName);
  });

  return {
    rows,
    leagueTop: rows.slice(0, WORST_DROPS_LEAGUE_LIMIT),
    byTeam,
    dropCount: rows.length,
    hasTransactions,
    disclaimer: WORST_DROPS_DISCLAIMER,
  };
}
