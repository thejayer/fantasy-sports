import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { HistoryPanel, type HistoryView } from "@/components/HistoryPanel";
import { MatchupsPanel, type MatchupsView } from "@/components/MatchupsPanel";
import { PlayersDataTable } from "@/components/PlayersDataTable";
import { ProjectionsBoard } from "@/components/ProjectionsBoard";
import { SeasonSwitcher } from "@/components/SeasonSwitcher";
import { ToolsPanel, type ToolsView } from "@/components/ToolsPanel";
import type {
  DraftSimSnapshot,
  LeagueHistoryArchive,
  LeagueSnapshot,
  PlayerMapSnapshot,
  PlayoffOddsSnapshot,
  ProjectionSnapshot,
  Team,
  WeeklyProjectionSnapshot,
} from "@/lib/data";
import { isPitcher } from "@/lib/baseball";
import {
  recordLabel,
  sportFormatLabel,
  winPctLabel,
} from "@/lib/league";
import {
  attachPlayerProjections,
  indexPlayerMap,
  indexProjections,
  usesHalfPprScoringFallback,
} from "@/lib/projection-join";

function RoleSwitcher({
  leagueId,
  season,
  tab,
  role,
}: {
  leagueId: string;
  season: number;
  tab: string;
  role: string;
}) {
  const roles = [
    { id: "all", label: "All" },
    { id: "batter", label: "Batters" },
    { id: "pitcher", label: "Pitchers" },
  ];
  return (
    <div className="tabs" style={{ marginTop: "0.5rem" }}>
      {roles.map((item) => (
        <Link
          key={item.id}
          href={`/leagues/${leagueId}?season=${season}&tab=${tab}&role=${item.id}`}
          className={`tab${role === item.id ? " active" : ""}`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

function StandingsTable({
  league,
  leagueId,
}: {
  league: LeagueSnapshot;
  leagueId: string;
}) {
  const isFootball = league.sport === "football";
  const showPoints = league.teams.some((team) => team.points_for != null);
  const showAgainst = isFootball;
  const pointsLabel = isFootball ? "PF" : "Points";

  if (!league.teams.length) {
    return (
      <EmptyState title="No teams in this snapshot">
        Standings will appear after the next sync or seed for this season.
      </EmptyState>
    );
  }

  return (
    <div className="panel table-scroll">
      <table className="table-cards">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>Owner</th>
            <th>Record</th>
            <th>Win%</th>
            {isFootball || showPoints ? <th>{pointsLabel}</th> : null}
            {showAgainst ? <th>PA</th> : null}
          </tr>
        </thead>
        <tbody>
          {league.teams.map((team) => (
            <tr key={team.team_id}>
              <td data-label="#">{team.standing ?? "—"}</td>
              <td data-label="Team">
                <Link
                  href={`/leagues/${leagueId}/teams/${team.team_id}?season=${league.season}`}
                >
                  {team.name}
                </Link>
              </td>
              <td data-label="Owner">{team.owners.join(", ") || "—"}</td>
              <td data-label="Record">{recordLabel(team)}</td>
              <td data-label="Win%">{winPctLabel(team)}</td>
              {isFootball || showPoints ? (
                <td data-label={pointsLabel}>
                  {team.points_for?.toFixed?.(1) ?? "—"}
                </td>
              ) : null}
              {showAgainst ? (
                <td data-label="PA">{team.points_against?.toFixed?.(1) ?? "—"}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamsList({
  league,
  leagueId,
}: {
  league: LeagueSnapshot;
  leagueId: string;
}) {
  if (!league.teams.length) {
    return (
      <EmptyState title="No teams yet">
        This season snapshot has no team list to browse.
      </EmptyState>
    );
  }

  return (
    <div className="league-list">
      {league.teams.map((team: Team) => (
        <Link
          key={team.team_id}
          className="league-link"
          href={`/leagues/${leagueId}/teams/${team.team_id}?season=${league.season}`}
        >
          <div>
            <strong>{team.name}</strong>
            <div className="league-meta">
              {team.owners.join(", ") || "No owner listed"} · {recordLabel(team)}{" "}
              ({winPctLabel(team)})
            </div>
          </div>
          <span className="pill">{team.roster.length} on roster</span>
        </Link>
      ))}
    </div>
  );
}

const FOOTBALL_TABS = [
  "standings",
  "teams",
  "players",
  "matchups",
  "history",
  "projections",
  "tools",
] as const;

const BASEBALL_TABS = [
  "standings",
  "teams",
  "players",
  "matchups",
  "history",
  "projections",
  "tools",
] as const;

export function LeagueView({
  league,
  seasons,
  tab,
  role = "all",
  week,
  matchupsView = "week",
  historyArchive = null,
  historyView = "standings",
  h2hA,
  h2hB,
  projectionSnapshot = null,
  playerMap = null,
  projectionScoring = null,
  toolsView = "trade",
  toolsTeamA,
  toolsTeamB,
  toolsTeamId,
  draftSlot = 1,
  availableDraftSlots = [],
  draftSimSnapshot = null,
  weeklyProjectionSnapshot = null,
  playoffOddsSnapshot = null,
}: {
  league: LeagueSnapshot;
  seasons: number[];
  tab: string;
  role?: string;
  week?: number;
  matchupsView?: MatchupsView;
  historyArchive?: LeagueHistoryArchive | null;
  historyView?: HistoryView;
  h2hA?: number;
  h2hB?: number;
  projectionSnapshot?: ProjectionSnapshot | null;
  playerMap?: PlayerMapSnapshot | null;
  projectionScoring?: string | null;
  toolsView?: ToolsView;
  /** Trade side A (`?a=`). */
  toolsTeamA?: number;
  /** Trade side B (`?b=`). */
  toolsTeamB?: number;
  /** Start/Sit team (`?team=`). */
  toolsTeamId?: number;
  draftSlot?: number;
  availableDraftSlots?: number[];
  draftSimSnapshot?: DraftSimSnapshot | null;
  weeklyProjectionSnapshot?: WeeklyProjectionSnapshot | null;
  playoffOddsSnapshot?: PlayoffOddsSnapshot | null;
}) {
  const leagueId = league.league_id;
  const isBaseball = league.sport === "baseball";
  const period = league.period_label || (isBaseball ? "period" : "week");
  const tabs = isBaseball ? BASEBALL_TABS : FOOTBALL_TABS;
  const active = (tabs as readonly string[]).includes(tab) ? tab : "standings";
  const activeRole = isBaseball ? role : undefined;
  const halfPprFallback = usesHalfPprScoringFallback(league);

  const historyPair =
    h2hA != null && h2hB != null ? `&a=${h2hA}&b=${h2hB}` : "";
  const toolsPair = (() => {
    if (toolsView === "draft") return `&view=draft&slot=${draftSlot}`;
    if (toolsView === "start-sit") {
      return (
        `&view=start-sit` +
        (toolsTeamId != null ? `&team=${toolsTeamId}` : "")
      );
    }
    if (toolsView === "trade") {
      const a =
        toolsTeamA != null
          ? `&a=${toolsTeamA}`
          : h2hA != null
            ? `&a=${h2hA}`
            : "";
      const b =
        toolsTeamB != null
          ? `&b=${toolsTeamB}`
          : h2hB != null
            ? `&b=${h2hB}`
            : "";
      return `&view=trade${a}${b}`;
    }
    return `&view=${toolsView}`;
  })();

  const scoringQuery =
    active === "projections" && projectionScoring
      ? `&scoring=${projectionScoring}`
      : "";

  const seasonHrefExtra =
    active === "players" && activeRole
      ? `&role=${activeRole}`
      : active === "matchups"
        ? `&view=${matchupsView}${week != null ? `&week=${week}` : ""}`
        : active === "history"
          ? `&view=${historyView}${historyPair}`
          : active === "projections"
            ? scoringQuery
            : active === "tools"
              ? toolsPair
              : "";

  const players = isBaseball
    ? league.players.filter((player) => {
        if (role === "batter") return !isPitcher(player);
        if (role === "pitcher") return isPitcher(player);
        return true;
      })
    : league.players;

  const espnToGsis = indexPlayerMap(playerMap);
  const byGsis = indexProjections(projectionSnapshot);
  const playersWithProjections =
    !isBaseball && projectionSnapshot
      ? attachPlayerProjections(players, espnToGsis, byGsis)
      : players;

  return (
    <main className={`section league-view sport-${league.sport}`}>
      <div className="league-kicker">
        <span className="pill sport-pill">
          {sportFormatLabel(league.sport, league.format)}
        </span>
        <span className="league-meta">
          season {league.season}
          {league.current_week ? ` · ${period} ${league.current_week}` : ""}
          {league.scoring_type ? ` · ${league.scoring_type}` : ""}
          {isBaseball ? " · ESPN data · no engine projections" : ""}
        </span>
      </div>
      <h2>{league.name}</h2>
      <p className="lede">
        {league.team_count} teams
        {league.synced_at
          ? ` · synced ${new Date(league.synced_at).toLocaleString()}`
          : ""}
        {isBaseball
          ? ". Standings, matchups, history, and batter/pitcher boards from ESPN — projection-free by design (roadmap 4.6)."
          : ". Standings, matchups, history, rosters, projections, and decision tools."}
      </p>

      <SeasonSwitcher
        seasons={seasons}
        current={league.season}
        hrefFor={(season) =>
          `/leagues/${leagueId}?season=${season}&tab=${active}${seasonHrefExtra}`
        }
      />

      <div className="tabs">
        {tabs.map((name) => (
          <Link
            key={name}
            href={
              `/leagues/${leagueId}?season=${league.season}&tab=${name}` +
              (name === "players" && activeRole ? `&role=${activeRole}` : "") +
              (name === "matchups"
                ? `&view=${matchupsView}${week != null ? `&week=${week}` : ""}`
                : "") +
              (name === "history" ? `&view=${historyView}${historyPair}` : "") +
              (name === "projections" && projectionScoring
                ? `&scoring=${projectionScoring}`
                : "") +
              (name === "tools" ? toolsPair : "")
            }
            className={`tab${active === name ? " active" : ""}`}
          >
            {name}
          </Link>
        ))}
      </div>

      {active === "standings" ? (
        <StandingsTable league={league} leagueId={leagueId} />
      ) : null}

      {active === "teams" ? <TeamsList league={league} leagueId={leagueId} /> : null}

      {active === "players" ? (
        <>
          {isBaseball ? (
            <RoleSwitcher
              leagueId={leagueId}
              season={league.season}
              tab="players"
              role={role}
            />
          ) : null}
          <PlayersDataTable
            players={playersWithProjections}
            sport={league.sport}
            role={role}
            showProjections={!isBaseball && Boolean(projectionSnapshot)}
          />
        </>
      ) : null}

      {active === "matchups" ? (
        <MatchupsPanel league={league} week={week} view={matchupsView} />
      ) : null}

      {active === "history" ? (
        <HistoryPanel
          archive={historyArchive}
          leagueId={leagueId}
          season={league.season}
          view={historyView}
          a={h2hA}
          b={h2hB}
        />
      ) : null}

      {active === "projections" ? (
        isBaseball ? (
          <EmptyState title="Baseball stays projection-free by design">
            The <code>ffa</code> engine is NFL-only (nflverse weekly stats, GSIS
            ids, football scoring). Baseball-dynasty keeps the richest ESPN hub
            UI — standings, matchups, history, batter/pitcher boards — without a
            half-built MLB model. Extending projections to baseball is a future
            product decision, not a missing tab.
          </EmptyState>
        ) : (
          <>
            <div className="tabs" style={{ marginTop: "0.5rem" }}>
              {(["ppr", "standard"] as const).map((slug) => (
                <Link
                  key={slug}
                  href={`/leagues/${leagueId}?season=${league.season}&tab=projections&scoring=${slug}`}
                  className={`tab${(projectionScoring ?? "ppr") === slug ? " active" : ""}`}
                >
                  {slug}
                </Link>
              ))}
            </div>
            <ProjectionsBoard
              snapshot={projectionSnapshot}
              leagueSeason={league.season}
              halfPprFallback={halfPprFallback}
            />
          </>
        )
      ) : null}

      {active === "tools" ? (
        isBaseball ? (
          <EmptyState title="Decision tools are football-only by design">
            Trade, waiver, strength, draft, start/sit, and playoff boards join
            NFL projection snapshots. Baseball members use ESPN standings,
            matchups, and roster boards instead — same deliberate scope as the
            projections tab (roadmap 4.6).
          </EmptyState>
        ) : (
          <ToolsPanel
            league={league}
            view={toolsView}
            a={toolsTeamA ?? h2hA}
            b={toolsTeamB ?? h2hB}
            team={toolsTeamId}
            slot={draftSlot}
            availableDraftSlots={availableDraftSlots}
            projectionSnapshot={projectionSnapshot}
            playerMap={playerMap}
            draftSimSnapshot={draftSimSnapshot}
            weeklyProjectionSnapshot={weeklyProjectionSnapshot}
            playoffOddsSnapshot={playoffOddsSnapshot}
            halfPprFallback={halfPprFallback}
          />
        )
      ) : null}
    </main>
  );
}
