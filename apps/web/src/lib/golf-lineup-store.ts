/**
 * Server-only golf lineup writes. Keep out of client bundles.
 */

import type { LeagueSnapshot } from "@/lib/data";
import type { GolfWeekLineup } from "@/lib/golf-lineup";
import { writeGolfLeagueSnapshot } from "@/lib/golf-store";

/**
 * Patch one team's event lineup onto a loaded snapshot and persist v2 under
 * the writable store (merges fixture index when empty).
 */
export async function saveGolfTeamLineup(options: {
  league: LeagueSnapshot;
  teamId: number;
  eventId: string;
  lineup: GolfWeekLineup;
}): Promise<{ root: string; path: string }> {
  const { league, teamId, eventId, lineup } = options;
  if (!league.lineups) {
    throw new Error("league has no lineups concern");
  }
  const teams = { ...league.lineups.teams };
  const key = String(teamId);
  teams[key] = { ...(teams[key] ?? {}), [eventId]: lineup };
  const next: LeagueSnapshot = {
    ...league,
    lineups: {
      ...league.lineups,
      current_event_id: league.lineups.current_event_id ?? eventId,
      teams,
    },
  };
  // writeGolfLeagueSnapshot accepts create snapshots; pass through fields.
  return writeGolfLeagueSnapshot(
    next as Parameters<typeof writeGolfLeagueSnapshot>[0],
  );
}
