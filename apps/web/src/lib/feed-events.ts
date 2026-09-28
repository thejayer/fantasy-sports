/**
 * System event stream for the league feed (roadmap 7.6 step 1).
 *
 * Built only from snapshot data already on disk — transactions, draft picks,
 * and completed weekly results. No writes. Stable ids so comments/reactions
 * can target an event across polls.
 */

import {
  activityRowsForLeague,
  formatActivityDate,
  type ActivityActionRow,
} from "@/lib/activity";
import type { DraftPick, LeagueSnapshot, Team } from "@/lib/data";
import { teamNameById } from "@/lib/draft-results";
import { gamesForPeriod, periodCount } from "@/lib/matchups";

export type FeedEventKind =
  | "trade"
  | "waiver"
  | "draft"
  | "result"
  | "digest"
  | "other";

export type SystemFeedEvent = {
  id: string;
  kind: FeedEventKind;
  /** ms since epoch — shared sort key with hub ISO timestamps. */
  sortKey: number;
  occurredAt: string;
  dateLabel: string;
  title: string;
  body: string;
  teamIds: number[];
  playerIds: number[];
  /** Optional deep link within the hub. */
  href?: string;
};

const DRAFT_INDIVIDUAL_CAP = 48;

function isoFromMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return new Date(0).toISOString();
  return new Date(ms).toISOString();
}

function labelFromMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function eventsFromActivity(
  league: LeagueSnapshot,
): SystemFeedEvent[] {
  const rows = activityRowsForLeague(league, "all");
  // Group trade legs that share a transaction date + adjacent keys into one card.
  const byTx = new Map<string, ActivityActionRow[]>();
  for (const row of rows) {
    const txKey = `${row.dateRaw ?? "x"}:${row.sortKey}`;
    const list = byTx.get(txKey) ?? [];
    list.push(row);
    byTx.set(txKey, list);
  }

  const events: SystemFeedEvent[] = [];
  for (const [txKey, group] of byTx) {
    const hasTrade = group.some((r) => r.kind === "trade");
    const allWaiver = group.every((r) => r.kind === "waiver");
    const resolvedKind: FeedEventKind = hasTrade
      ? "trade"
      : allWaiver
        ? "waiver"
        : "other";

    const sortKey = group[0]?.sortKey ?? 0;
    const teamIds = [
      ...new Set(
        group.map((r) => r.teamId).filter((id): id is number => id != null),
      ),
    ];
    const playerIds = [
      ...new Set(
        group
          .map((r) => r.playerId)
          .filter((id): id is number => id != null),
      ),
    ];
    const teamLabels = [
      ...new Set(group.map((r) => r.teamName).filter(Boolean)),
    ];
    const lines = group.map((r) => {
      const bid =
        r.bidAmount > 0 ? ` ($${r.bidAmount.toFixed(0)} FAAB)` : "";
      return `${r.teamName}: ${r.action} ${r.playerName}${bid}`;
    });
    const title =
      resolvedKind === "trade"
        ? `Trade · ${teamLabels.join(" ↔ ") || "league"}`
        : resolvedKind === "waiver"
          ? group.length === 1
            ? `${group[0].teamName} · ${group[0].action}`
            : `Adds / drops · ${group.length} moves`
          : `Activity · ${group.length} actions`;

    events.push({
      id: `tx:${league.league_id}:${league.season}:${txKey}:${group.map((r) => r.key).join("|")}`,
      kind: resolvedKind,
      sortKey,
      occurredAt: isoFromMs(sortKey),
      dateLabel: group[0]?.dateLabel ?? formatActivityDate(group[0]?.dateRaw),
      title,
      body: lines.join("\n"),
      teamIds,
      playerIds,
      href: `/leagues/${league.league_id}?season=${league.season}&tab=activity`,
    });
  }
  return events;
}

function eventsFromDraft(league: LeagueSnapshot): SystemFeedEvent[] {
  const draft = league.draft ?? [];
  if (!draft.length) return [];
  const names = teamNameById(league.teams);
  const seasonStart = Date.UTC(league.season, 7, 1); // Aug 1 of season year as anchor

  if (draft.length > DRAFT_INDIVIDUAL_CAP) {
    return [
      {
        id: `draft:${league.league_id}:${league.season}:summary`,
        kind: "draft",
        sortKey: seasonStart,
        occurredAt: isoFromMs(seasonStart),
        dateLabel: labelFromMs(seasonStart),
        title: `Draft complete · ${draft.length} picks`,
        body: `${league.name ?? league.league_id} finished its ${league.sport} draft.`,
        teamIds: [
          ...new Set(
            draft
              .map((p) => p.team_id)
              .filter((id): id is number => id != null),
          ),
        ],
        playerIds: [],
        href: `/leagues/${league.league_id}?season=${league.season}&tab=draft`,
      },
    ];
  }

  return draft.map((pick: DraftPick, index: number) => {
    const teamName =
      pick.team_id != null
        ? (names.get(pick.team_id) ?? `Team ${pick.team_id}`)
        : "—";
    const round = pick.round ?? "?";
    const roundPick = pick.round_pick ?? "?";
    const bid =
      pick.bid_amount > 0 ? ` for $${pick.bid_amount.toFixed(0)}` : "";
    const keeper = pick.keeper ? " (keeper)" : "";
    const sortKey = seasonStart + index * 1000;
    return {
      id: `draft:${league.league_id}:${league.season}:${index}:${pick.player_id ?? "x"}`,
      kind: "draft" as const,
      sortKey,
      occurredAt: isoFromMs(sortKey),
      dateLabel: labelFromMs(sortKey),
      title: `Pick ${round}.${roundPick} · ${teamName}`,
      body: `${pick.player_name ?? "Unknown player"}${bid}${keeper}`,
      teamIds: pick.team_id != null ? [pick.team_id] : [],
      playerIds: pick.player_id != null ? [pick.player_id] : [],
      href:
        pick.player_id != null
          ? `/leagues/${league.league_id}/players/${pick.player_id}?season=${league.season}`
          : `/leagues/${league.league_id}?season=${league.season}&tab=draft`,
    };
  });
}

function eventsFromResults(league: LeagueSnapshot): SystemFeedEvent[] {
  const teams = league.teams ?? [];
  const max = periodCount(teams);
  if (max <= 0) return [];
  const events: SystemFeedEvent[] = [];
  // Anchor results to mid-week of each period so they sort after typical waiver days.
  const seasonStart = Date.UTC(league.season, 8, 1); // Sep 1

  for (let period = 1; period <= max; period++) {
    const bundle = gamesForPeriod(teams, period);
    const decided = bundle.games.filter((g) => {
      const o = g.left.outcome;
      return o === "W" || o === "L" || o === "T";
    });
    if (!decided.length) continue;

    const lines = decided.map((g) => {
      const leftScore = g.left.score ?? 0;
      const rightScore = g.right.score ?? 0;
      return `${g.left.name} ${leftScore.toFixed(1)} – ${rightScore.toFixed(1)} ${g.right.name}`;
    });
    const sortKey = seasonStart + period * 7 * 24 * 60 * 60 * 1000;
    events.push({
      id: `result:${league.league_id}:${league.season}:${period}`,
      kind: "result",
      sortKey,
      occurredAt: isoFromMs(sortKey),
      dateLabel: `Week ${period}`,
      title: `Week ${period} results`,
      body: lines.join("\n"),
      teamIds: [
        ...new Set(
          decided.flatMap((g) => [g.left.teamId, g.right.teamId]),
        ),
      ],
      playerIds: [],
      href: `/leagues/${league.league_id}?season=${league.season}&tab=matchups&view=week&week=${period}`,
    });
  }
  return events;
}

export type FeedEventFilter = "all" | "trades" | "waivers" | "results" | "draft";

/** Chronological system stream (newest first). */
export function systemFeedEvents(
  league: LeagueSnapshot,
  filter: FeedEventFilter = "all",
): SystemFeedEvent[] {
  const events = [
    ...eventsFromActivity(league),
    ...eventsFromDraft(league),
    ...eventsFromResults(league),
  ];
  const filtered =
    filter === "all"
      ? events
      : filter === "trades"
        ? events.filter((e) => e.kind === "trade")
        : filter === "waivers"
          ? events.filter((e) => e.kind === "waiver")
          : filter === "results"
            ? events.filter((e) => e.kind === "result")
            : events.filter((e) => e.kind === "draft");
  return filtered.sort(
    (a, b) => b.sortKey - a.sortKey || a.id.localeCompare(b.id),
  );
}

/** Team still in the league for a given id (season guard). */
export function teamStillPresent(
  teams: Team[],
  teamId: number | null | undefined,
): boolean {
  if (teamId == null) return false;
  return teams.some((t) => t.team_id === teamId);
}
