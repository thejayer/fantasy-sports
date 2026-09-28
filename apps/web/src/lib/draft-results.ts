/**
 * ESPN draft-results helpers (not Monte Carlo draft-sim).
 * Snapshot field: league.draft — already synced by sj.
 */

import type { DraftPick, LeagueSnapshot, Team } from "@/lib/data";

export type DraftResultRow = DraftPick & {
  teamName: string;
  pickIndex: number;
};

export function teamNameById(teams: Team[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const team of teams) {
    map.set(team.team_id, team.name);
  }
  return map;
}

/** Stable sort: round, then round_pick, then original order. */
export function sortDraftPicks(picks: DraftPick[]): DraftPick[] {
  return picks
    .map((pick, index) => ({ pick, index }))
    .sort((a, b) => {
      const ra = a.pick.round ?? Number.POSITIVE_INFINITY;
      const rb = b.pick.round ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      const pa = a.pick.round_pick ?? Number.POSITIVE_INFINITY;
      const pb = b.pick.round_pick ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      return a.index - b.index;
    })
    .map(({ pick }) => pick);
}

export function draftResultRows(
  league: Pick<LeagueSnapshot, "draft" | "teams">,
  teamFilter?: number | null,
): DraftResultRow[] {
  const names = teamNameById(league.teams);
  const picks = sortDraftPicks(league.draft ?? []);
  const rows: DraftResultRow[] = [];
  picks.forEach((pick, pickIndex) => {
    if (
      teamFilter != null &&
      Number.isFinite(teamFilter) &&
      pick.team_id !== teamFilter
    ) {
      return;
    }
    rows.push({
      ...pick,
      teamName:
        pick.team_id != null
          ? (names.get(pick.team_id) ?? `Team ${pick.team_id}`)
          : "—",
      pickIndex: pickIndex + 1,
    });
  });
  return rows;
}

export function draftHasBids(picks: DraftPick[]): boolean {
  return picks.some((pick) => (pick.bid_amount ?? 0) > 0);
}

export function draftHasKeepers(picks: DraftPick[]): boolean {
  return picks.some((pick) => Boolean(pick.keeper));
}

/**
 * ESPN player ids marked keeper on the draft board (roadmap 7.9b).
 * Optional `teamId` scopes to one franchise's kept players for roster badges.
 */
export function keeperPlayerIds(
  picks: DraftPick[] | null | undefined,
  teamId?: number | null,
): Set<string> {
  const ids = new Set<string>();
  for (const pick of picks ?? []) {
    if (!pick.keeper || pick.player_id == null) continue;
    if (
      teamId != null &&
      Number.isFinite(teamId) &&
      pick.team_id !== teamId
    ) {
      continue;
    }
    ids.add(String(pick.player_id));
  }
  return ids;
}

export function isKeeperPlayer(
  playerId: number | string | null | undefined,
  keepers: Set<string>,
): boolean {
  if (playerId == null || playerId === "") return false;
  return keepers.has(String(playerId));
}
