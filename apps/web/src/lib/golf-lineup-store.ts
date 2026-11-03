/** Merge only one team's event into the authoritative lineups concern. */
import type { LeagueSnapshot } from "@/lib/data";
import type { GolfLineupsFile, GolfWeekLineup } from "@/lib/golf-lineup";
import { mutateGolfDocument } from "@/lib/golf-document-store";
import { hubDataRoot } from "@/lib/hub-paths";
import { writeGolfLeagueSnapshot } from "@/lib/golf-store";

export class GolfLineupValidationError extends Error {}

export async function saveGolfTeamLineup(options: {
  league: LeagueSnapshot;
  teamId: number;
  eventId: string;
  prepare: (current: GolfLineupsFile) => GolfWeekLineup;
}): Promise<{ root: string; path: string; lineup: GolfWeekLineup }> {
  const { league, teamId, eventId, prepare } = options;
  if (!league.lineups) throw new Error("league has no lineups concern");
  const manifest = `${league.league_id}/${league.season}/manifest.json`;
  const initialized = await mutateGolfDocument<unknown, boolean>(manifest, current => ({ result: current !== null }));
  if (!initialized) {
    await writeGolfLeagueSnapshot(league as Parameters<typeof writeGolfLeagueSnapshot>[0], { preserveLineups: true });
  }
  const relative = `${league.league_id}/${league.season}/lineups.json`;
  return mutateGolfDocument<GolfLineupsFile, { root: string; path: string; lineup: GolfWeekLineup }>(relative, current => {
    const lineups = current ?? league.lineups!;
    const lineup = prepare(lineups);
    const key = String(teamId);
    return {
      value: { ...lineups, teams: { ...lineups.teams, [key]: { ...(lineups.teams[key] ?? {}), [eventId]: lineup } } },
      result: { root: hubDataRoot(), path: manifest, lineup },
    };
  });
}
