import Link from "next/link";
import { ActivityPanel } from "@/components/ActivityPanel";
import { DraftResultsPanel } from "@/components/DraftResultsPanel";
import { EmptyState } from "@/components/EmptyState";
import { FreeAgentsBoard } from "@/components/FreeAgentsBoard";
import { AuctionRoomPanel } from "@/components/AuctionRoomPanel";
import { GolfLineupPanel } from "@/components/GolfLineupPanel";
import { GolfSchedulePanel } from "@/components/GolfSchedulePanel";
import { GolfScoreboardPanel } from "@/components/GolfScoreboardPanel";
import { GolfSettingsPanel } from "@/components/GolfSettingsPanel";
import { HistoryPanel, type HistoryView } from "@/components/HistoryPanel";
import { LeagueTabs, tabLabel } from "@/components/LeagueTabs";
import { MatchupsPanel, type MatchupsView } from "@/components/MatchupsPanel";
import { PlayersDataTable } from "@/components/PlayersDataTable";
import { ProjectionsBoard } from "@/components/ProjectionsBoard";
import { SeasonSwitcher } from "@/components/SeasonSwitcher";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ToolsPanel, type ToolsView } from "@/components/ToolsPanel";
import { TeamIdentity } from "@/components/TeamAvatar";
import { ViewerBadge } from "@/components/ViewerBadge";
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
import type { ActivityView } from "@/lib/activity";
import { isPitcher } from "@/lib/baseball";
import {
  recordLabel,
  sportFormatLabel,
  winPctLabel,
} from "@/lib/league";
import { syncedLabel } from "@/lib/member-home";
import {
  attachPlayerProjections,
  indexPlayerMap,
  indexProjections,
  usesHalfPprScoringFallback,
} from "@/lib/projection-join";
import type { GolfActingScope } from "@/lib/hub-members";

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
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  leagueId: string;
  viewerTeamId?: number;
}) {
  const isFootball = league.sport === "football";
  const isGolf = league.sport === "golf";
  const seasonPoints = isGolf && league.format === "season_points";
  const showRecord = !seasonPoints;
  const showPoints =
    isFootball ||
    isGolf ||
    league.teams.some((team) => team.points_for != null);
  const showAgainst = isFootball || (isGolf && !seasonPoints);
  const pointsLabel = isFootball || (isGolf && !seasonPoints) ? "PF" : "Points";

  if (!league.teams.length) {
    return (
      <EmptyState title="No teams in this snapshot">
        Standings will appear after the next sync or seed for this season.
      </EmptyState>
    );
  }

  const rows = isGolf
    ? [...league.teams].sort(
        (a, b) =>
          (a.standing ?? 999) - (b.standing ?? 999) || a.team_id - b.team_id,
      )
    : league.teams;

  return (
    <div className="panel table-scroll">
      {isGolf ? (
        <p className="league-meta" style={{ margin: "0.75rem 1rem 0" }}>
          {seasonPoints
            ? "Season points from scored event weeks (roadmap 6.4e)."
            : "H2H record from scored event weeks (roadmap 6.4e)."}
        </p>
      ) : null}
      <table className="table-cards">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>Owner</th>
            {showRecord ? <th>Record</th> : null}
            {showRecord ? <th>Win%</th> : null}
            {showPoints ? <th>{pointsLabel}</th> : null}
            {showAgainst ? <th>PA</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((team) => (
            <tr
              key={team.team_id}
              className={team.team_id === viewerTeamId ? "is-viewer" : undefined}
            >
              <td data-label="#">{team.standing ?? "—"}</td>
              <td data-label="Team">
                <TeamIdentity name={team.name} logoUrl={team.logo_url}>
                  <Link
                    href={`/leagues/${leagueId}/teams/${team.team_id}?season=${league.season}`}
                  >
                    {team.name}
                  </Link>
                  {team.team_id === viewerTeamId ? <ViewerBadge /> : null}
                </TeamIdentity>
              </td>
              <td data-label="Owner">
                {team.owners.length ? (
                  <Link href={`/leagues/${leagueId}/franchises/${team.team_id}`}>
                    {team.owners.join(", ")}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              {showRecord ? (
                <td data-label="Record">{recordLabel(team)}</td>
              ) : null}
              {showRecord ? (
                <td data-label="Win%">{winPctLabel(team)}</td>
              ) : null}
              {showPoints ? (
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
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  leagueId: string;
  viewerTeamId?: number;
}) {
  const isGolf = league.sport === "golf";
  if (!league.teams.length) {
    return (
      <EmptyState title="No teams yet">
        This season snapshot has no team list to browse.
      </EmptyState>
    );
  }

  return (
    <div className="league-list">
      {isGolf ? (
        <p className="lede" style={{ marginBottom: "0.75rem" }}>
          Season rosters are GS starters + BE bench. Open a team for current-event
          Alt1/Alt2, or use the Lineup tab to set the week.
        </p>
      ) : null}
      {league.teams.map((team: Team) => {
        const gs = isGolf
          ? team.roster.filter((p) => p.slot === "GS").length
          : null;
        const be = isGolf
          ? team.roster.filter((p) => p.slot === "BE").length
          : null;
        return (
          <Link
            key={team.team_id}
            className={
              "league-link" + (team.team_id === viewerTeamId ? " is-viewer" : "")
            }
            href={`/leagues/${leagueId}/teams/${team.team_id}?season=${league.season}`}
          >
            <TeamIdentity name={team.name} logoUrl={team.logo_url} size="md">
              <strong>
                {team.name}
                {team.team_id === viewerTeamId ? <ViewerBadge /> : null}
              </strong>
              <div className="league-meta">
                {team.owners.join(", ") || "No owner listed"} ·{" "}
                {recordLabel(team)} ({winPctLabel(team)})
              </div>
            </TeamIdentity>
            <span className="pill">
              {isGolf
                ? `${gs} GS · ${be} BE`
                : `${team.roster.length} on roster`}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

const FOOTBALL_TABS = [
  "standings",
  "teams",
  "players",
  "matchups",
  "draft",
  "activity",
  "history",
  "projections",
  "tools",
  "settings",
] as const;

const BASEBALL_TABS = [
  "standings",
  "teams",
  "players",
  "matchups",
  "draft",
  "activity",
  "waivers",
  "history",
  "projections",
  "tools",
  "settings",
] as const;

/** Golf lane (roadmap 6.4a–e + 6.5 + live auction). */
const GOLF_TABS = [
  "standings",
  "teams",
  "settings",
  "schedule",
  "lineup",
  "scoreboard",
  "draft",
  "auction",
  "history",
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
  activityView = "all",
  draftTeamId,
  golfEventId,
  golfLineupTeamId,
  golfActingScope,
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
  viewerTeamId,
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
  activityView?: ActivityView;
  /** ESPN draft-results team filter (`?tab=draft&team=`). */
  draftTeamId?: number;
  /** Golf event id (`?tab=lineup|scoreboard&event=`). */
  golfEventId?: string;
  /** Golf lineup / auction team filter (`?tab=lineup|auction&team=`). */
  golfLineupTeamId?: number;
  /** Email↔franchise ACL scope for golf auction/lineup UI. */
  golfActingScope?: GolfActingScope;
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
  /** Signed-in member's franchise in this league (roadmap 7.1). */
  viewerTeamId?: number;
}) {
  const leagueId = league.league_id;
  const isBaseball = league.sport === "baseball";
  const isGolf = league.sport === "golf";
  const isFootball = league.sport === "football";
  const period =
    league.period_label ||
    (isGolf ? "event" : isBaseball ? "period" : "week");
  const tabs = isGolf ? GOLF_TABS : isBaseball ? BASEBALL_TABS : FOOTBALL_TABS;
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

  const lineupQuery =
    active === "lineup"
      ? (golfEventId ? `&event=${golfEventId}` : "") +
        (golfLineupTeamId != null ? `&team=${golfLineupTeamId}` : "")
      : "";
  const scoreboardQuery =
    active === "scoreboard" && golfEventId ? `&event=${golfEventId}` : "";
  const auctionQuery =
    active === "auction" && golfLineupTeamId != null
      ? `&team=${golfLineupTeamId}`
      : "";

  const seasonHrefExtra =
    active === "players" && activeRole
      ? `&role=${activeRole}`
      : active === "matchups"
        ? `&view=${matchupsView}${week != null ? `&week=${week}` : ""}`
        : active === "draft"
          ? draftTeamId != null
            ? `&team=${draftTeamId}`
            : ""
          : active === "lineup"
            ? lineupQuery
            : active === "scoreboard"
              ? scoreboardQuery
              : active === "auction"
                ? auctionQuery
                : active === "activity"
                  ? `&view=${activityView}`
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
    isFootball && projectionSnapshot
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
          {isGolf ? " · hub golf · no tour feed yet" : ""}
        </span>
      </div>
      <h2>{league.name}</h2>
      {/*
        The lede used to enumerate the tabs, which the tab strip right below
        already does, and it cost three lines of a phone viewport before any
        data (roadmap 7.5). Keep only what the tabs cannot say.
      */}
      <p className="lede league-lede">
        {league.team_count} teams
        {syncedLabel(league.synced_at) ? ` · synced ${syncedLabel(league.synced_at)}` : ""}
        {isGolf
          ? " · hub-native PGA Tour counting league"
          : isBaseball
            ? " · projection-free by design"
            : ""}
      </p>

      <SeasonSwitcher
        seasons={seasons}
        current={league.season}
        hrefFor={(season) =>
          `/leagues/${leagueId}?season=${season}&tab=${active}${seasonHrefExtra}`
        }
      />

      <LeagueTabs
        active={active}
        tabs={tabs.map((name) => ({
          id: name,
          label: tabLabel(name),
          href:
            `/leagues/${leagueId}?season=${league.season}&tab=${name}` +
            (name === "players" && activeRole ? `&role=${activeRole}` : "") +
            (name === "matchups"
              ? `&view=${matchupsView}${week != null ? `&week=${week}` : ""}`
              : "") +
            (name === "draft" && draftTeamId != null
              ? `&team=${draftTeamId}`
              : "") +
            (name === "lineup"
              ? (golfEventId ? `&event=${golfEventId}` : "") +
                (golfLineupTeamId != null ? `&team=${golfLineupTeamId}` : "")
              : "") +
            (name === "activity" ? `&view=${activityView}` : "") +
            (name === "history" ? `&view=${historyView}${historyPair}` : "") +
            (name === "projections" && projectionScoring
              ? `&scoring=${projectionScoring}`
              : "") +
            (name === "tools" ? toolsPair : ""),
        }))}
      />

      {active === "standings" ? (
        <StandingsTable
          league={league}
          leagueId={leagueId}
          viewerTeamId={viewerTeamId}
        />
      ) : null}

      {active === "teams" ? (
        <TeamsList
          league={league}
          leagueId={leagueId}
          viewerTeamId={viewerTeamId}
        />
      ) : null}

      {active === "settings" ? (
        isGolf ? (
          <GolfSettingsPanel league={league} />
        ) : (
          <SettingsPanel league={league} />
        )
      ) : null}

      {active === "schedule" && isGolf ? (
        <GolfSchedulePanel league={league} />
      ) : null}

      {active === "lineup" && isGolf ? (
        <GolfLineupPanel
          league={league}
          eventId={golfEventId}
          teamId={golfLineupTeamId}
          actingScope={golfActingScope}
        />
      ) : null}

      {active === "scoreboard" && isGolf ? (
        <GolfScoreboardPanel league={league} eventId={golfEventId} />
      ) : null}

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
            showProjections={isFootball && Boolean(projectionSnapshot)}
            leagueId={leagueId}
            season={league.season}
          />
        </>
      ) : null}

      {active === "matchups" ? (
        <MatchupsPanel
          league={league}
          week={week}
          view={matchupsView}
          viewerTeamId={viewerTeamId}
        />
      ) : null}

      {active === "draft" ? (
        <DraftResultsPanel league={league} teamId={draftTeamId} />
      ) : null}

      {active === "auction" && isGolf ? (
        <AuctionRoomPanel
          league={league}
          teamId={golfLineupTeamId}
          actingScope={golfActingScope}
        />
      ) : null}

      {active === "activity" ? (
        <ActivityPanel league={league} view={activityView} />
      ) : null}

      {active === "waivers" ? (
        <FreeAgentsBoard
          agents={league.free_agents ?? []}
          sport={league.sport}
        />
      ) : null}

      {active === "history" ? (
        <HistoryPanel
          archive={historyArchive}
          leagueId={leagueId}
          season={league.season}
          view={historyView}
          a={h2hA}
          b={h2hB}
          sport={league.sport}
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
            Trade, strength, draft-sim, start/sit, and playoff boards join NFL
            projection snapshots. Baseball free agents live under the Waivers
            tab; draft results and activity are shared ESPN tabs — same
            deliberate scope as the projections tab (roadmap 4.6).
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
            viewerTeamId={viewerTeamId}
          />
        )
      ) : null}
    </main>
  );
}
