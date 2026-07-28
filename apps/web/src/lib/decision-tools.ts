/**
 * Snapshot-backed decision helpers (roadmap 4.5).
 * Trade / waiver / roster-strength over season projection quantiles.
 * Does not call ffa — join ESPN ids via player_map like 4.4.
 */

import type {
  LeagueSnapshot,
  Player,
  ProjectionPlayer,
  ProjectionSnapshot,
  Team,
} from "@/lib/data";
import {
  attachPlayerProjections,
  indexPlayerMap,
  indexProjections,
  normalizeEspnId,
  projectionForEspnId,
  type PlayerWithProjection,
} from "@/lib/projection-join";
import type { PlayerMapSnapshot } from "@/lib/data";

export type RosterProjectionTotals = {
  floor: number;
  median: number;
  ceiling: number;
  mean: number;
  vor: number;
  mapped: number;
  rostered: number;
};

export type TeamStrengthRow = {
  teamId: number;
  name: string;
  owners: string[];
  totals: RosterProjectionTotals;
};

export type TradeSideDelta = {
  before: RosterProjectionTotals;
  after: RosterProjectionTotals;
  deltaMedian: number;
  deltaVor: number;
};

export function emptyRosterTotals(rostered = 0): RosterProjectionTotals {
  return {
    floor: 0,
    median: 0,
    ceiling: 0,
    mean: 0,
    vor: 0,
    mapped: 0,
    rostered,
  };
}

export function sumRosterProjections(
  players: PlayerWithProjection[],
): RosterProjectionTotals {
  const totals = emptyRosterTotals(players.length);
  for (const player of players) {
    const proj = player.projection;
    if (!proj) continue;
    totals.mapped += 1;
    totals.floor += proj.floor ?? 0;
    totals.median += proj.median ?? 0;
    totals.ceiling += proj.ceiling ?? 0;
    totals.mean += proj.points_mean ?? 0;
    totals.vor += proj.vor ?? 0;
  }
  return totals;
}

export function rosterWithProjections(
  roster: Player[],
  espnToGsis: Map<string, string>,
  byGsis: Map<string, ProjectionPlayer>,
): PlayerWithProjection[] {
  return attachPlayerProjections(roster, espnToGsis, byGsis);
}

export function teamStrengthRows(
  league: LeagueSnapshot,
  espnToGsis: Map<string, string>,
  byGsis: Map<string, ProjectionPlayer>,
): TeamStrengthRow[] {
  return league.teams
    .map((team) => ({
      teamId: team.team_id,
      name: team.name,
      owners: team.owners ?? [],
      totals: sumRosterProjections(
        rosterWithProjections(team.roster ?? [], espnToGsis, byGsis),
      ),
    }))
    .sort((a, b) => b.totals.median - a.totals.median || b.totals.vor - a.totals.vor);
}

/** Apply a trade: remove `give` ESPN ids from A, add `get` players onto A (and inverse for B). */
export function applyTradeRosters(
  teamA: Team,
  teamB: Team,
  giveEspnIds: Array<string | number>,
  getEspnIds: Array<string | number>,
): { rosterA: Player[]; rosterB: Player[] } {
  const give = new Set(
    giveEspnIds.map(normalizeEspnId).filter((id): id is string => Boolean(id)),
  );
  const get = new Set(
    getEspnIds.map(normalizeEspnId).filter((id): id is string => Boolean(id)),
  );

  const fromA = (teamA.roster ?? []).filter((p) => {
    const id = normalizeEspnId(p.id);
    return id != null && give.has(id);
  });
  const fromB = (teamB.roster ?? []).filter((p) => {
    const id = normalizeEspnId(p.id);
    return id != null && get.has(id);
  });

  const rosterA = [
    ...(teamA.roster ?? []).filter((p) => {
      const id = normalizeEspnId(p.id);
      return id == null || !give.has(id);
    }),
    ...fromB,
  ];
  const rosterB = [
    ...(teamB.roster ?? []).filter((p) => {
      const id = normalizeEspnId(p.id);
      return id == null || !get.has(id);
    }),
    ...fromA,
  ];
  return { rosterA, rosterB };
}

export function evaluateTrade(
  teamA: Team,
  teamB: Team,
  giveEspnIds: Array<string | number>,
  getEspnIds: Array<string | number>,
  espnToGsis: Map<string, string>,
  byGsis: Map<string, ProjectionPlayer>,
): { sideA: TradeSideDelta; sideB: TradeSideDelta } {
  const beforeA = sumRosterProjections(
    rosterWithProjections(teamA.roster ?? [], espnToGsis, byGsis),
  );
  const beforeB = sumRosterProjections(
    rosterWithProjections(teamB.roster ?? [], espnToGsis, byGsis),
  );
  const { rosterA, rosterB } = applyTradeRosters(
    teamA,
    teamB,
    giveEspnIds,
    getEspnIds,
  );
  const afterA = sumRosterProjections(
    rosterWithProjections(rosterA, espnToGsis, byGsis),
  );
  const afterB = sumRosterProjections(
    rosterWithProjections(rosterB, espnToGsis, byGsis),
  );
  return {
    sideA: {
      before: beforeA,
      after: afterA,
      deltaMedian: afterA.median - beforeA.median,
      deltaVor: afterA.vor - beforeA.vor,
    },
    sideB: {
      before: beforeB,
      after: afterB,
      deltaMedian: afterB.median - beforeB.median,
      deltaVor: afterB.vor - beforeB.vor,
    },
  };
}

export type WaiverRow = ProjectionPlayer & {
  espn_id?: string | null;
  percent_owned?: number | null;
  source: "espn" | "proxy";
};

export type WaiverBoardData = {
  rows: WaiverRow[];
  source: "espn" | "proxy";
};

/**
 * Engine projection rows not on any football roster in the snapshot.
 * Fallback when the season has no synced ESPN free_agents list.
 */
export function unrosteredProjectionRows(
  league: LeagueSnapshot,
  playerMap: PlayerMapSnapshot | null | undefined,
  snapshot: ProjectionSnapshot | null | undefined,
): ProjectionPlayer[] {
  if (!snapshot?.players?.length) return [];
  const espnToGsis = indexPlayerMap(playerMap);
  const rosteredGsis = new Set<string>();
  for (const team of league.teams) {
    for (const player of team.roster ?? []) {
      const espn = normalizeEspnId(player.id);
      if (!espn) continue;
      const gsis = espnToGsis.get(espn);
      if (gsis) rosteredGsis.add(gsis);
    }
  }
  // Also treat denormalized league.players as rostered.
  for (const player of league.players ?? []) {
    const espn = normalizeEspnId(player.id);
    if (!espn) continue;
    const gsis = espnToGsis.get(espn);
    if (gsis) rosteredGsis.add(gsis);
  }

  return snapshot.players
    .filter((row) => row.player_id && !rosteredGsis.has(row.player_id))
    .slice()
    .sort((a, b) => (b.vor ?? 0) - (a.vor ?? 0));
}

/**
 * Prefer ESPN free_agents (joined to projections when the map hits); else the
 * unrostered-projection proxy.
 */
export function waiverBoardRows(
  league: LeagueSnapshot,
  playerMap: PlayerMapSnapshot | null | undefined,
  snapshot: ProjectionSnapshot | null | undefined,
): WaiverBoardData {
  const agents = league.free_agents ?? [];
  if (agents.length > 0) {
    const espnToGsis = indexPlayerMap(playerMap);
    const byGsis = indexProjections(snapshot);
    const rows: WaiverRow[] = agents.map((agent) => {
      const espn = normalizeEspnId(agent.id);
      const proj = projectionForEspnId(agent.id, espnToGsis, byGsis);
      if (proj) {
        return {
          ...proj,
          espn_id: espn,
          percent_owned: agent.percent_owned ?? null,
          source: "espn",
        };
      }
      return {
        player_id: espn ?? String(agent.id ?? "unknown"),
        player_name: agent.name,
        position: agent.position,
        team: agent.pro_team,
        points_mean: null,
        points_sd: null,
        floor: null,
        median: null,
        ceiling: null,
        vor: null,
        tier: null,
        espn_id: espn,
        percent_owned: agent.percent_owned ?? null,
        source: "espn",
      };
    });
    rows.sort((a, b) => {
      const vorA = a.vor;
      const vorB = b.vor;
      if (vorA != null && vorB != null && vorA !== vorB) return vorB - vorA;
      if (vorA != null && vorB == null) return -1;
      if (vorA == null && vorB != null) return 1;
      return (b.percent_owned ?? 0) - (a.percent_owned ?? 0);
    });
    return { rows, source: "espn" };
  }

  const proxy = unrosteredProjectionRows(league, playerMap, snapshot).map(
    (row) => ({ ...row, source: "proxy" as const }),
  );
  return { rows: proxy, source: "proxy" };
}

export function defaultToolsPair(league: LeagueSnapshot): {
  a: number;
  b: number;
} | null {
  const teams = league.teams ?? [];
  if (teams.length < 2) return null;
  return { a: teams[0].team_id, b: teams[1].team_id };
}

export function findTeam(
  league: LeagueSnapshot,
  teamId: number | undefined,
): Team | null {
  if (teamId == null || Number.isNaN(teamId)) return null;
  return league.teams.find((t) => t.team_id === teamId) ?? null;
}

/** Build join indexes once for tools surfaces. */
export function projectionIndexes(
  playerMap: PlayerMapSnapshot | null | undefined,
  snapshot: ProjectionSnapshot | null | undefined,
): {
  espnToGsis: Map<string, string>;
  byGsis: Map<string, ProjectionPlayer>;
} {
  return {
    espnToGsis: indexPlayerMap(playerMap),
    byGsis: indexProjections(snapshot),
  };
}

export { projectionForEspnId };
