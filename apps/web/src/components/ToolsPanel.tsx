import Link from "next/link";
import { Suspense } from "react";
import { DraftBoard } from "@/components/DraftBoard";
import { EmptyState } from "@/components/EmptyState";
import { PlayoffOddsBoard } from "@/components/PlayoffOddsBoard";
import { StartSitBoard } from "@/components/StartSitBoard";
import { TradeAnalyzer } from "@/components/TradeAnalyzer";
import { WaiverBoard } from "@/components/WaiverBoard";
import type {
  DraftSimSnapshot,
  LeagueSnapshot,
  PlayerMapSnapshot,
  PlayoffOddsSnapshot,
  ProjectionSnapshot,
  WeeklyProjectionSnapshot,
} from "@/lib/data";
import {
  defaultToolsPair,
  defaultToolsTeam,
  projectionIndexes,
  teamStrengthRows,
  waiverBoardRows,
} from "@/lib/decision-tools";
import { ViewerBadge } from "@/components/ViewerBadge";
import {
  formatProjectionPoints,
  indexPlayerMap,
  indexProjections,
} from "@/lib/projection-join";

export type ToolsView =
  | "trade"
  | "waivers"
  | "strength"
  | "draft"
  | "start-sit"
  | "playoff-odds";

function toolsHref(
  leagueId: string,
  season: number,
  view: ToolsView,
  opts: { a?: number; b?: number; team?: number; slot?: number },
): string {
  const query = new URLSearchParams({
    season: String(season),
    tab: "tools",
    view,
  });
  if (view === "trade") {
    if (opts.a != null) query.set("a", String(opts.a));
    if (opts.b != null) query.set("b", String(opts.b));
  } else if (view === "start-sit") {
    if (opts.team != null) query.set("team", String(opts.team));
  } else if (view === "draft" && opts.slot != null) {
    query.set("slot", String(opts.slot));
  }
  return `/leagues/${leagueId}?${query.toString()}`;
}

function ViewSwitcher({
  leagueId,
  season,
  view,
  a,
  b,
  team,
  slot,
}: {
  leagueId: string;
  season: number;
  view: ToolsView;
  a?: number;
  b?: number;
  team?: number;
  slot?: number;
}) {
  const views: Array<{ id: ToolsView; label: string }> = [
    { id: "trade", label: "Trade" },
    { id: "waivers", label: "Waivers" },
    { id: "strength", label: "Strength" },
    { id: "draft", label: "Draft" },
    { id: "start-sit", label: "Start/Sit" },
    { id: "playoff-odds", label: "Playoffs" },
  ];
  return (
    <div className="tabs" style={{ marginTop: "0.5rem" }}>
      {views.map((item) => (
        <Link
          key={item.id}
          href={toolsHref(leagueId, season, item.id, { a, b, team, slot })}
          className={`tab${view === item.id ? " active" : ""}`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

function StrengthTable({
  league,
  playerMap,
  snapshot,
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  playerMap: PlayerMapSnapshot | null;
  snapshot: ProjectionSnapshot | null;
  viewerTeamId?: number;
}) {
  const { espnToGsis, byGsis } = projectionIndexes(playerMap, snapshot);
  const rows = teamStrengthRows(league, espnToGsis, byGsis);
  if (!snapshot?.players?.length) {
    return (
      <EmptyState title="No projection snapshot">
        Roster strength needs <code>ffa export-projections</code> in the store.
      </EmptyState>
    );
  }
  return (
    <div className="panel table-scroll" style={{ marginTop: "0.75rem" }}>
      <p className="lede">
        Season projection totals by roster (independent quantile sums). Mapped
        count is how many ESPN roster slots resolved through the player map.
      </p>
      <table className="table-cards">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>Mapped</th>
            <th>Floor</th>
            <th>Median</th>
            <th>Ceiling</th>
            <th>VOR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.teamId}
              className={row.teamId === viewerTeamId ? "is-viewer" : undefined}
            >
              <td data-label="#">{index + 1}</td>
              <td data-label="Team">
                <Link
                  href={`/leagues/${league.league_id}/teams/${row.teamId}?season=${league.season}`}
                >
                  {row.name}
                </Link>
                {row.teamId === viewerTeamId ? <ViewerBadge /> : null}
                {row.owners.length ? (
                  <div className="league-meta">{row.owners.join(", ")}</div>
                ) : null}
              </td>
              <td data-label="Mapped">
                {row.totals.mapped}/{row.totals.rostered}
              </td>
              <td data-label="Floor">
                {formatProjectionPoints(row.totals.floor)}
              </td>
              <td data-label="Median">
                {formatProjectionPoints(row.totals.median)}
              </td>
              <td data-label="Ceiling">
                {formatProjectionPoints(row.totals.ceiling)}
              </td>
              <td data-label="VOR">
                {formatProjectionPoints(row.totals.vor)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ToolsPanel({
  league,
  view,
  a,
  b,
  team,
  slot = 1,
  availableDraftSlots = [],
  projectionSnapshot,
  playerMap,
  draftSimSnapshot,
  weeklyProjectionSnapshot,
  playoffOddsSnapshot,
  halfPprFallback = false,
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  view: ToolsView;
  a?: number;
  b?: number;
  team?: number;
  slot?: number;
  availableDraftSlots?: number[];
  projectionSnapshot: ProjectionSnapshot | null;
  playerMap: PlayerMapSnapshot | null;
  draftSimSnapshot?: DraftSimSnapshot | null;
  weeklyProjectionSnapshot?: WeeklyProjectionSnapshot | null;
  playoffOddsSnapshot?: PlayoffOddsSnapshot | null;
  halfPprFallback?: boolean;
  /** Signed-in member's franchise — every tool opens on it (roadmap 7.1). */
  viewerTeamId?: number;
}) {
  const pair = defaultToolsPair(league, viewerTeamId);
  const teamA = a ?? pair?.a;
  const teamB = b ?? pair?.b;
  const { espnToGsis, byGsis } = projectionIndexes(playerMap, projectionSnapshot);
  const weeklyByGsis = indexProjections(weeklyProjectionSnapshot ?? null);
  const espnMap = indexPlayerMap(playerMap);
  const startSitTeamId =
    team ?? defaultToolsTeam(league, viewerTeamId) ?? 1;
  const seasonFallback =
    projectionSnapshot != null &&
    projectionSnapshot.season !== league.season;
  const weeklySeasonFallback =
    weeklyProjectionSnapshot != null &&
    weeklyProjectionSnapshot.season !== league.season;

  return (
    <div className="tools-panel">
      <ViewSwitcher
        leagueId={league.league_id}
        season={league.season}
        view={view}
        a={teamA}
        b={teamB}
        team={startSitTeamId}
        slot={slot}
      />

      {halfPprFallback || seasonFallback || weeklySeasonFallback ? (
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          {halfPprFallback
            ? "This league scores half-PPR; tools use the PPR export until a dedicated half-PPR snapshot exists. "
            : null}
          {seasonFallback
            ? `Hub season ${league.season}; season boards use NFL ${projectionSnapshot!.season} (nearest available export). `
            : null}
          {weeklySeasonFallback && !seasonFallback
            ? `Hub season ${league.season}; weekly boards use NFL ${weeklyProjectionSnapshot!.season} (nearest available export). `
            : null}
        </p>
      ) : null}

      {view === "trade" ? (
        !projectionSnapshot?.players?.length ? (
          <EmptyState title="No projection snapshot for trades">
            Run <code>ffa export-projections</code> and{" "}
            <code>ffa export-player-map</code> into the hub store first.
          </EmptyState>
        ) : teamA == null || teamB == null ? (
          <EmptyState title="Need two teams">
            This league snapshot does not have enough teams to compare.
          </EmptyState>
        ) : (
          <Suspense fallback={<p className="muted">Loading trade tool…</p>}>
            <TradeAnalyzer
              teams={league.teams}
              espnToGsisEntries={[...espnToGsis.entries()]}
              projectionEntries={[...byGsis.entries()]}
              initialA={teamA}
              initialB={teamB}
              leagueId={league.league_id}
              season={league.season}
            />
          </Suspense>
        )
      ) : null}

      {view === "waivers" ? (
        <WaiverBoard
          board={waiverBoardRows(league, playerMap, projectionSnapshot)}
        />
      ) : null}

      {view === "strength" ? (
        <StrengthTable
          league={league}
          playerMap={playerMap}
          snapshot={projectionSnapshot}
          viewerTeamId={viewerTeamId}
        />
      ) : null}

      {view === "draft" ? (
        <DraftBoard
          snapshot={draftSimSnapshot ?? null}
          leagueId={league.league_id}
          season={league.season}
          slot={slot}
          availableSlots={availableDraftSlots}
        />
      ) : null}

      {view === "start-sit" ? (
        !weeklyProjectionSnapshot?.players?.length ? (
          <EmptyState title="No weekly projection snapshot">
            Run <code>ffa export-weekly-projections</code> into the hub store
            (typical-week grain). Season totals under{" "}
            <code>export-projections</code> are not used for start/sit.
          </EmptyState>
        ) : (
          <Suspense fallback={<p className="muted">Loading start/sit…</p>}>
            <StartSitBoard
              teams={league.teams}
              espnToGsisEntries={[...espnMap.entries()]}
              weeklyEntries={[...weeklyByGsis.entries()]}
              initialTeamId={startSitTeamId}
              leagueId={league.league_id}
              season={league.season}
            />
          </Suspense>
        )
      ) : null}

      {view === "playoff-odds" ? (
        <PlayoffOddsBoard
          snapshot={playoffOddsSnapshot ?? null}
          viewerTeamId={viewerTeamId}
        />
      ) : null}
    </div>
  );
}
