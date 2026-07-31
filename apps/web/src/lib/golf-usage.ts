/**
 * Per-segment start usage board (roadmap 8.3).
 */

import type { LeagueSnapshot, Player } from "@/lib/data";
import { DEFAULT_GOLF_SETTINGS, parseGolfSettings } from "@/lib/golf";
import { segmentStartCounts } from "@/lib/golf-lineup";

export type GolfUsagePlayerRow = {
  playerId: number;
  name: string;
  teamId: number;
  teamName: string;
  segmentId: string;
  used: number;
  max: number | null;
  remaining: number | null;
};

export type GolfUsageBoard = {
  maxPerSegment: number | null;
  segments: string[];
  rows: GolfUsagePlayerRow[];
  disclaimer: string;
};

function playerName(roster: Player[], id: number): string {
  return roster.find((p) => Number(p.id) === id)?.name ?? `#${id}`;
}

export function buildGolfUsageBoard(league: LeagueSnapshot): GolfUsageBoard {
  const golf = parseGolfSettings(league.settings) ?? DEFAULT_GOLF_SETTINGS;
  const max = golf.starts.max_per_segment;
  const events = league.lineups?.events ?? [];
  const segments = [
    ...new Set(
      events
        .map((e) => e.segment_id)
        .filter((s): s is string => Boolean(s)),
    ),
  ].sort();
  const rows: GolfUsagePlayerRow[] = [];

  for (const team of league.teams) {
    const teamLineups = league.lineups?.teams?.[String(team.team_id)] ?? {};
    for (const segmentId of segments.length ? segments : ["default"]) {
      const counts = segmentStartCounts(
        teamLineups,
        events.map((e) => ({
          ...e,
          segment_id: e.segment_id ?? "default",
        })),
        segmentId,
      );
      for (const [playerId, used] of counts) {
        rows.push({
          playerId,
          name: playerName(team.roster ?? [], playerId),
          teamId: team.team_id,
          teamName: team.name,
          segmentId,
          used,
          max: max && max > 0 ? max : null,
          remaining: max && max > 0 ? max - used : null,
        });
      }
    }
  }

  rows.sort(
    (a, b) =>
      a.segmentId.localeCompare(b.segmentId) ||
      b.used - a.used ||
      a.teamName.localeCompare(b.teamName) ||
      a.name.localeCompare(b.name),
  );

  return {
    maxPerSegment: max && max > 0 ? max : null,
    segments,
    rows,
    disclaimer:
      max && max > 0
        ? `Season start caps: ${max} per segment (settings.golf.starts.max_per_segment). Counts lineup starter slots only — alts do not consume a start.`
        : "No per-segment start cap configured (unlimited).",
  };
}
