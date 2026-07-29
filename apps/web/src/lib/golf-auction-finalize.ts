/**
 * Commit a completed auction room into the season snapshot (draft + rosters).
 */

import {
  owgrPool,
  poolSizeForLeague,
  type GolfDraftPick,
  type GolfPlayerRow,
} from "@/lib/golf-draft";
import {
  buildLineupsPayload,
  GOLF_FIXTURE_NOW,
} from "@/lib/golf-lineup";
import {
  applyMatchupsFromScoreboard,
  applyStandingsFromScoreboard,
  buildScoreboardPayload,
} from "@/lib/golf-score";
import {
  buildGolfSnapshot,
  DEFAULT_GOLF_SETTINGS,
  GOLF_STARTERS,
  parseGolfSettings,
  type GolfFormat,
  type GolfSettings,
} from "@/lib/golf";
import type { AuctionRoom } from "@/lib/golf-auction-room";
import type { LeagueSnapshot } from "@/lib/data";
import { writeGolfLeagueSnapshot } from "@/lib/golf-store";

function playerRow(
  id: number,
  name: string,
  owgr: number,
  country: string | null,
  slot: string,
): GolfPlayerRow {
  return {
    id,
    name,
    position: "G",
    slot,
    pro_team: country,
    injury_status: null,
    status: "ACTIVE",
    injured: false,
    eligible_slots: ["GS", "BE", "ALT"],
    acquisition_type: slot === "FA" ? "FREEAGENT" : "DRAFT",
    percent_owned: null,
    total_points: 0,
    projected_total_points: null,
    avg_points: null,
    season_stats: { OWGR: owgr },
    role: "golfer",
  };
}

export async function finalizeAuctionRoom(
  room: AuctionRoom,
  league: LeagueSnapshot,
): Promise<LeagueSnapshot> {
  if (room.phase !== "complete" && room.phase !== "finalized") {
    throw new Error("room must be complete before finalize");
  }
  const golf: GolfSettings =
    parseGolfSettings(league.settings) ?? DEFAULT_GOLF_SETTINGS;
  const starters = room.starters || golf.roster.starters || GOLF_STARTERS;
  const bench = room.roster_slots - starters;

  const size = poolSizeForLeague(room.team_ids.length, starters, bench);
  const pool = owgrPool(size);
  const byId = new Map(pool.map((p) => [p.id, p]));

  type GolfSnapTeam = ReturnType<typeof buildGolfSnapshot>["teams"][number];
  const teams: GolfSnapTeam[] = league.teams.map((team) => ({
    team_id: team.team_id,
    name: team.name,
    abbrev: team.abbrev || team.name,
    owners: team.owners ?? [],
    logo_url: null,
    wins: 0,
    losses: 0,
    ties: 0,
    win_pct: 0,
    points_for: 0,
    points_against: 0,
    standing: team.standing ?? team.team_id,
    division: team.division ?? "",
    schedule: [] as number[],
    scores: [] as Array<number | null>,
    outcomes: [] as string[],
    roster: [] as GolfPlayerRow[],
  }));
  const teamById = new Map(teams.map((t) => [t.team_id, t]));

  const picks: GolfDraftPick[] = [...room.picks].sort(
    (a, b) => a.round - b.round || a.round_pick - b.round_pick,
  );
  for (const pick of picks) {
    const team = teamById.get(pick.team_id);
    const golfer = byId.get(pick.player_id);
    if (!team || !golfer) continue;
    const slot = team.roster.length < starters ? "GS" : "BE";
    team.roster.push(
      playerRow(golfer.id, golfer.name, golfer.owgr_rank, golfer.country, slot),
    );
  }

  const draftedIds = new Set(picks.map((p) => p.player_id));
  const free_agents = pool
    .filter((p) => !draftedIds.has(p.id))
    .map((p) => playerRow(p.id, p.name, p.owgr_rank, p.country, "FA"));

  const playersMap = new Map<number, GolfPlayerRow>();
  for (const team of teams) {
    for (const player of team.roster as GolfPlayerRow[]) {
      if (playersMap.has(player.id)) continue;
      playersMap.set(player.id, { ...player, fantasy_team: team.name });
    }
  }
  const players = [...playersMap.values()].sort(
    (a, b) => a.season_stats.OWGR - b.season_stats.OWGR,
  );

  const format = (
    league.format === "season_points" ? "season_points" : "h2h"
  ) as GolfFormat;
  const synced_at = new Date().toISOString();
  const lineups = buildLineupsPayload(teams, league.season, golf, {
    savedAt: synced_at,
    nowIso: GOLF_FIXTURE_NOW,
  });
  const scoreboard = buildScoreboardPayload(teams, lineups, golf, synced_at);
  applyStandingsFromScoreboard(teams, scoreboard, format);
  applyMatchupsFromScoreboard(teams, scoreboard);

  const snapshot = {
    schema_version: 2,
    league_id: league.league_id,
    espn_league_id: null as number | null,
    sport: "golf" as const,
    format,
    season: league.season,
    name: league.name,
    short_name: league.short_name ?? league.name,
    scoring_type: "GOLF_COUNTING",
    team_count: league.team_count,
    current_week: 1 as number | null,
    period_label: "event",
    synced_at,
    settings: {
      team_count: league.team_count,
      scoring_type: "GOLF_COUNTING",
      golf,
    },
    draft: picks,
    transactions: [] as unknown[],
    free_agents,
    teams,
    players,
    lineups,
    scoreboard,
  } satisfies ReturnType<typeof buildGolfSnapshot>;

  await writeGolfLeagueSnapshot(snapshot);
  return snapshot as unknown as LeagueSnapshot;
}
