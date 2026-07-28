import Link from "next/link";
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
  projectionIndexes,
  teamStrengthRows,
  waiverBoardRows,
} from "@/lib/decision-tools";
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
  | "playoff-odds"
  | "deferred";

function ViewSwitcher({
  leagueId,
  season,
  view,
  a,
  b,
  slot,
}: {
  leagueId: string;
  season: number;
  view: ToolsView;
  a?: number;
  b?: number;
  slot?: number;
}) {
  const views: Array<{ id: ToolsView; label: string }> = [
    { id: "trade", label: "Trade" },
    { id: "waivers", label: "Waivers" },
    { id: "strength", label: "Strength" },
    { id: "draft", label: "Draft" },
    { id: "start-sit", label: "Start/Sit" },
    { id: "playoff-odds", label: "Playoffs" },
    { id: "deferred", label: "More" },
  ];
  const pair = a != null && b != null ? `&a=${a}&b=${b}` : "";
  return (
    <div className="tabs" style={{ marginTop: "0.5rem" }}>
      {views.map((item) => (
        <Link
          key={item.id}
          href={`/leagues/${leagueId}?season=${season}&tab=tools&view=${item.id}${
            item.id === "draft" && slot != null ? `&slot=${slot}` : pair
          }`}
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
}: {
  league: LeagueSnapshot;
  playerMap: PlayerMapSnapshot | null;
  snapshot: ProjectionSnapshot | null;
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
            <tr key={row.teamId}>
              <td data-label="#">{index + 1}</td>
              <td data-label="Team">
                <Link
                  href={`/leagues/${league.league_id}/teams/${row.teamId}?season=${league.season}`}
                >
                  {row.name}
                </Link>
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
  slot = 1,
  projectionSnapshot,
  playerMap,
  draftSimSnapshot,
  weeklyProjectionSnapshot,
  playoffOddsSnapshot,
}: {
  league: LeagueSnapshot;
  view: ToolsView;
  a?: number;
  b?: number;
  slot?: number;
  projectionSnapshot: ProjectionSnapshot | null;
  playerMap: PlayerMapSnapshot | null;
  draftSimSnapshot?: DraftSimSnapshot | null;
  weeklyProjectionSnapshot?: WeeklyProjectionSnapshot | null;
  playoffOddsSnapshot?: PlayoffOddsSnapshot | null;
}) {
  const pair = defaultToolsPair(league);
  const teamA = a ?? pair?.a;
  const teamB = b ?? pair?.b;
  const { espnToGsis, byGsis } = projectionIndexes(playerMap, projectionSnapshot);
  const weeklyByGsis = indexProjections(weeklyProjectionSnapshot ?? null);
  const espnMap = indexPlayerMap(playerMap);
  const maxSlot = draftSimSnapshot?.teams ?? 12;
  const startSitTeamId = teamA ?? league.teams[0]?.team_id ?? 1;

  return (
    <div className="tools-panel">
      <ViewSwitcher
        leagueId={league.league_id}
        season={league.season}
        view={view}
        a={teamA}
        b={teamB}
        slot={slot}
      />

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
          <TradeAnalyzer
            teams={league.teams}
            espnToGsisEntries={[...espnToGsis.entries()]}
            projectionEntries={[...byGsis.entries()]}
            initialA={teamA}
            initialB={teamB}
          />
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
        />
      ) : null}

      {view === "draft" ? (
        <DraftBoard
          snapshot={draftSimSnapshot ?? null}
          leagueId={league.league_id}
          season={league.season}
          slot={slot}
          maxSlot={maxSlot}
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
          <StartSitBoard
            teams={league.teams}
            espnToGsisEntries={[...espnMap.entries()]}
            weeklyEntries={[...weeklyByGsis.entries()]}
            initialTeamId={startSitTeamId}
          />
        )
      ) : null}

      {view === "playoff-odds" ? (
        <PlayoffOddsBoard snapshot={playoffOddsSnapshot ?? null} />
      ) : null}

      {view === "deferred" ? (
        <EmptyState title="More tools notes">
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
            <li>
              <strong>Playoff odds</strong> — use the Playoffs tools view (
              offline <code>ffa export-playoff-odds</code>). Make-playoffs only;
              not bracket champion odds.
            </li>
            <li>
              <strong>Start/Sit</strong> — typical-week posteriors via Start/Sit (
              not season quantile boards).
            </li>
            <li>
              <strong>ESPN free agents</strong> — synced into{" "}
              <code>free_agents.json</code> (size-capped). The Waivers view uses
              that list when present; otherwise it falls back to unrostered
              projections.
            </li>
          </ul>
        </EmptyState>
      ) : null}
    </div>
  );
}
