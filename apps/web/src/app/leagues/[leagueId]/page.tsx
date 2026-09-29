import { notFound } from "next/navigation";
import type { HistoryView } from "@/components/HistoryPanel";
import { LeagueView } from "@/components/LeagueView";
import type { MatchupsView } from "@/components/MatchupsPanel";
import type { ToolsView } from "@/components/ToolsPanel";
import { parseAnalysisSeriesMode } from "@/lib/baseball-analysis";
import { parseBaseballToolsView, parseTrailingWindow } from "@/lib/baseball-tools";
import { HOCKEY_DAILY_VIEWS, parseHockeyToolsView } from "@/lib/hockey-tools";
import { parseDate } from "@/lib/hockey-daily";
import type { ActivityView } from "@/lib/activity";
import {
  getDraftSimSnapshot,
  getLeagueHistoryArchive,
  getLeagueSeasons,
  getLeagueSnapshot,
  getBaseballAnalysis,
  getHockeyNhl,
  getHockeyValues,
  getHockeySchedule,
  getHockeyTeamStrength,
  getHockeyInjuryLog,
  getPlayerMap,
  getPlayoffOddsSamples,
  getPlayoffOddsSnapshot,
  getProSchedule,
  getProjectionSnapshot,
  getWeekBoxScore,
  getWeeklyProjectionSnapshot,
  listDraftSimSlots,
  listWeekBoxScoreWeeks,
  type DraftSimSnapshot,
  type PlayerMapSnapshot,
  type PlayoffOddsSamples,
  type PlayoffOddsSnapshot,
  type ProScheduleSnapshot,
  type ProjectionSnapshot,
  type WeekBoxScoreSnapshot,
  type WeeklyProjectionSnapshot,
} from "@/lib/data";
import { parseBoxPair } from "@/lib/box-score";
import {
  projectionSeasonCandidates,
  scoringSlugFromLeague,
} from "@/lib/projection-join";
import { resolveGolfActingScope } from "@/lib/franchise-acl";
import { getViewerTeamId } from "@/lib/viewer";
import { parseHockeyBoardQuery } from "@/lib/hockey-values";
import { parseIds, parseWaiverFilters } from "@/lib/hockey-decisions";
import { parsePlayerTableQuery } from "@/lib/player-table";
import { buildScoringSandboxModel } from "@/lib/scoring-sandbox";

// See app/page.tsx. Already dynamic today, but declared so adding
// generateStaticParams later cannot silently freeze snapshot data.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{
    tab?: string;
    season?: string;
    role?: string;
    week?: string;
    view?: string;
    a?: string;
    b?: string;
    team?: string;
    scoring?: string;
    slot?: string;
    event?: string;
    q?: string;
    pos?: string;
    sort?: string;
    dir?: string;
    p?: string;
    dp?: string;
    box?: string;
    window?: string;
    series?: string;
    who?: string;
    recent?: string;
    open?: string;
    ids?: string | string[];
    drop?: string;
    add?: string;
    healthy?: string;
    pp?: string;
    rookies?: string;
    tall?: string;
    iron?: string;
    date?: string;
  }>;
};

async function loadProjectionBundle(
  leagueSeason: number,
  scoring: string,
): Promise<{
  snapshot: ProjectionSnapshot | null;
  playerMap: PlayerMapSnapshot | null;
  scoring: string;
}> {
  let playerMap: PlayerMapSnapshot | null = null;
  for (const year of projectionSeasonCandidates(leagueSeason)) {
    const snapshot = await getProjectionSnapshot(scoring, year);
    const map = await getPlayerMap(year);
    if (map && !playerMap) playerMap = map;
    if (snapshot) {
      return { snapshot, playerMap: map ?? playerMap, scoring };
    }
  }
  return { snapshot: null, playerMap, scoring };
}

export default async function LeagueDetailPage({ params, searchParams }: Props) {
  const { leagueId } = await params;
  const {
    tab = "standings",
    season: seasonParam,
    role = "all",
    week: weekParam,
    view: viewParam,
    a: aParam,
    b: bParam,
    team: teamParam,
    scoring: scoringParam,
    slot: slotParam,
    event: eventParam,
    q: qParam,
    pos: posParam,
    sort: sortParam,
    dir: dirParam,
    p: pageParam,
    dp: draftPageParam,
    box: boxParam,
    window: windowParam,
    series: seriesParam,
    who: whoParam,
    recent: recentParam,
    open: openParam,
    ids: idsParam,
    drop: dropParam,
    add: addParam,
    healthy: healthyParam,
    pp: ppParam,
    rookies: rookiesParam,
    tall: tallParam,
    iron: ironParam,
    date: dateParam,
  } = await searchParams;
  const seasons = await getLeagueSeasons(leagueId);
  const season = seasonParam ? Number(seasonParam) : undefined;
  const week = weekParam ? Number(weekParam) : undefined;
  const a = aParam ? Number(aParam) : undefined;
  const b = bParam ? Number(bParam) : undefined;
  const team = teamParam ? Number(teamParam) : undefined;
  const requestedSlot = slotParam ? Number(slotParam) : undefined;

  const matchupsView = (
    ["week", "schedule", "playoffs"].includes(viewParam ?? "")
      ? viewParam
      : "week"
  ) as MatchupsView;
  const historyView = (
    ["standings", "trophies", "champions", "records", "h2h"].includes(
      viewParam ?? "",
    )
      ? viewParam
      : "standings"
  ) as HistoryView;
  const activityView = (
    ["all", "trades", "waivers", "results", "draft", "talk"].includes(
      viewParam ?? "",
    )
      ? viewParam
      : "all"
  ) as ActivityView;
  const league = await getLeagueSnapshot(
    leagueId,
    season && !Number.isNaN(season) ? season : undefined,
  );
  if (!league) {
    notFound();
  }

  const toolsView = (
    [
      "home",
      "trade",
      "waivers",
      "strength",
      "draft",
      "start-sit",
      "playoff-odds",
    ].includes(viewParam ?? "")
      ? viewParam
      : "home"
  ) as ToolsView;
  const baseballToolsView = parseBaseballToolsView(viewParam);
  const baseballTrailingWindow = parseTrailingWindow(windowParam);
  const hockeyToolsView = parseHockeyToolsView(viewParam);
  const analysisSeriesMode = parseAnalysisSeriesMode(seriesParam);

  const historyArchive =
    tab === "history" ? await getLeagueHistoryArchive(leagueId) : null;

  const proSchedule: ProScheduleSnapshot | null =
    league.sport === "baseball" && tab === "tools"
      ? await getProSchedule(league.league_id, league.season)
      : null;

  const baseballAnalysis =
    (league.sport === "baseball" || league.sport === "hockey") &&
    (tab === "analysis" ||
      (league.sport === "hockey" && tab === "tools" && hockeyToolsView === "pace"))
      ? await getBaseballAnalysis(league.league_id, league.season)
      : null;

  // Hockey decision tools (H5a) read values + bios + the NHL schedule.
  const hockeyDecisionTools =
    league.sport === "hockey" && tab === "tools" && hockeyToolsView !== "home" && hockeyToolsView !== "categories";
  // Hockey NHL sidecars (HOCKEY-PORT.md H1): Waivers board + decision tools.
  const hockeyNhl =
    league.sport === "hockey" && (tab === "waivers" || hockeyDecisionTools)
      ? await getHockeyNhl(league.league_id, league.season)
      : null;
  // Hockey player values (H2/H3): projections board + Waivers value column.
  const hockeyValues =
    league.sport === "hockey" &&
    (tab === "projections" || tab === "waivers" || hockeyDecisionTools)
      ? await getHockeyValues(league.league_id, league.season)
      : null;
  const hockeySchedule = hockeyDecisionTools
    ? await getHockeySchedule(league.league_id, league.season)
    : null;
  // H6 alerts: the injury log (ESPN + Daily Faceoff transitions).
  const hockeyInjuryLog =
    league.sport === "hockey" && tab === "tools" && hockeyToolsView === "alerts"
      ? await getHockeyInjuryLog(league.league_id, league.season)
      : null;
  // H5b goalie start model: goals / shots for and against per club.
  const hockeyTeamStrength =
    league.sport === "hockey" && tab === "tools" && HOCKEY_DAILY_VIEWS.has(hockeyToolsView)
      ? await getHockeyTeamStrength(league.league_id, league.season)
      : null;
  const hockeyBoardQuery = parseHockeyBoardQuery({
    pos: posParam,
    who: whoParam,
    sort: sortParam,
    dir: dirParam,
    p: pageParam,
    recent: recentParam,
    open: openParam,
  });

  const wantsProjections =
    league.sport === "football" &&
    (tab === "projections" || tab === "players" || tab === "tools");
  const scoringOverride =
    scoringParam === "standard" || scoringParam === "ppr"
      ? scoringParam
      : null;
  const projectionBundle = wantsProjections
    ? await loadProjectionBundle(
        league.season,
        scoringOverride ?? scoringSlugFromLeague(league),
      )
    : { snapshot: null, playerMap: null, scoring: scoringOverride };

  let draftSimSnapshot: DraftSimSnapshot | null = null;
  let availableDraftSlots: number[] = [];
  let draftSlot = 1;
  if (
    league.sport === "football" &&
    tab === "tools" &&
    toolsView === "draft"
  ) {
    const scoring = projectionBundle.scoring ?? scoringSlugFromLeague(league);
    for (const year of projectionSeasonCandidates(league.season)) {
      const slots = await listDraftSimSlots(scoring, year);
      if (slots.length) {
        availableDraftSlots = slots;
        break;
      }
    }
    const preferred =
      requestedSlot != null &&
      !Number.isNaN(requestedSlot) &&
      requestedSlot >= 1
        ? Math.trunc(requestedSlot)
        : availableDraftSlots[0] ?? 1;
    draftSlot = availableDraftSlots.includes(preferred)
      ? preferred
      : (availableDraftSlots[0] ?? preferred);
    for (const year of projectionSeasonCandidates(league.season)) {
      const snap = await getDraftSimSnapshot(scoring, year, draftSlot);
      if (snap) {
        draftSimSnapshot = snap;
        break;
      }
    }
  }

  let weeklyProjectionSnapshot: WeeklyProjectionSnapshot | null = null;
  if (
    league.sport === "football" &&
    tab === "tools" &&
    toolsView === "start-sit"
  ) {
    const scoring = projectionBundle.scoring ?? scoringSlugFromLeague(league);
    for (const year of projectionSeasonCandidates(league.season)) {
      const snap = await getWeeklyProjectionSnapshot(scoring, year);
      if (snap) {
        weeklyProjectionSnapshot = snap;
        break;
      }
    }
  }

  let playoffOddsSnapshot: PlayoffOddsSnapshot | null = null;
  let playoffOddsSamples: PlayoffOddsSamples | null = null;
  if (
    league.sport === "football" &&
    tab === "tools" &&
    (toolsView === "playoff-odds" || toolsView === "trade")
  ) {
    if (toolsView === "playoff-odds") {
      for (const year of projectionSeasonCandidates(league.season)) {
        const snap = await getPlayoffOddsSnapshot(league.league_id, year);
        if (snap) {
          playoffOddsSnapshot = snap;
          break;
        }
      }
      // League season file is keyed by hub season; also try exact league.season.
      if (!playoffOddsSnapshot) {
        playoffOddsSnapshot = await getPlayoffOddsSnapshot(
          league.league_id,
          league.season,
        );
      }
    }
    if (toolsView === "trade") {
      for (const year of projectionSeasonCandidates(league.season)) {
        const samples = await getPlayoffOddsSamples(league.league_id, year);
        if (samples) {
          playoffOddsSamples = samples;
          break;
        }
      }
      if (!playoffOddsSamples) {
        playoffOddsSamples = await getPlayoffOddsSamples(
          league.league_id,
          league.season,
        );
      }
    }
  }

  const boxPair =
    (league.sport === "football" ||
      league.sport === "baseball" ||
      league.sport === "hockey") &&
    tab === "matchups"
      ? parseBoxPair(boxParam)
      : null;
  let weekBoxScore: WeekBoxScoreSnapshot | null = null;
  const baseballUsageWeek =
    league.sport === "baseball" &&
    tab === "tools" &&
    baseballToolsView === "usage"
      ? (league.current_week ?? 1)
      : null;
  if (boxPair || baseballUsageWeek != null) {
    const boxWeek =
      baseballUsageWeek != null
        ? baseballUsageWeek
        : week != null && !Number.isNaN(week)
          ? week
          : (league.current_week ?? 1);
    weekBoxScore = await getWeekBoxScore(
      league.league_id,
      league.season,
      boxWeek,
    );
  }

  const golfActingScope =
    league.sport === "golf" && (tab === "lineup" || tab === "auction")
      ? await resolveGolfActingScope(
          league.league_id,
          league.teams.map((t) => t.team_id),
        )
      : undefined;

  // Only meaningful when the franchise is in this season's snapshot — a member
  // linked to a team that did not exist in 2016 must not highlight team_id 4.
  let scoringSandbox = null;
  if (tab === "sandbox") {
    const weekNums = await listWeekBoxScoreWeeks(
      league.league_id,
      league.season,
    );
    const weekDocs = await Promise.all(
      weekNums.map((n) =>
        getWeekBoxScore(league.league_id, league.season, n),
      ),
    );
    scoringSandbox = buildScoringSandboxModel(
      league,
      weekDocs.filter((doc): doc is WeekBoxScoreSnapshot => doc != null),
    );
  }

  const linkedTeamId = await getViewerTeamId(leagueId);
  const viewerTeamId = league.teams.some((t) => t.team_id === linkedTeamId)
    ? linkedTeamId
    : undefined;

  const playersQuery = parsePlayerTableQuery({
    q: qParam,
    pos: posParam,
    sort: sortParam,
    dir: dirParam,
    p: pageParam,
    defaultSort:
      league.sport === "football" && projectionBundle.snapshot
        ? "vor"
        : "fpts",
  });
  // Hockey tools are open to every member: any team can be picked; the linked
  // member's own team is the default, else the first team.
  const hockeyTeamId =
    team != null && league.teams.some((t) => t.team_id === team)
      ? team
      : (viewerTeamId ?? league.teams[0]?.team_id ?? null);
  const hockeyDecisionQuery = {
    teamId: hockeyTeamId,
    filters: parseWaiverFilters({
      pos: posParam,
      healthy: healthyParam,
      pp: ppParam,
      rookies: rookiesParam,
      tall: tallParam,
      iron: ironParam,
    }),
    ids: parseIds(idsParam),
    drop: dropParam && /^\d+$/.test(dropParam) ? dropParam : null,
    add: addParam && /^\d+$/.test(addParam) ? addParam : null,
    date: parseDate(dateParam),
  };
  const draftPage = Math.max(
    1,
    Number.parseInt(draftPageParam ?? "1", 10) || 1,
  );

  return (
    <LeagueView
      league={league}
      seasons={seasons}
      tab={tab}
      role={["all", "batter", "pitcher"].includes(role) ? role : "all"}
      week={week != null && !Number.isNaN(week) ? week : undefined}
      matchupsView={matchupsView}
      historyArchive={historyArchive}
      historyView={historyView}
      h2hA={a != null && !Number.isNaN(a) ? a : undefined}
      h2hB={b != null && !Number.isNaN(b) ? b : undefined}
      activityView={activityView}
      draftTeamId={
        tab === "draft" && team != null && !Number.isNaN(team)
          ? team
          : undefined
      }
      draftPage={draftPage}
      playersQuery={playersQuery}
      golfEventId={
        (tab === "lineup" || tab === "scoreboard") && eventParam
          ? eventParam
          : undefined
      }
      golfLineupTeamId={
        (tab === "lineup" || tab === "auction") &&
        team != null &&
        !Number.isNaN(team)
          ? team
          : undefined
      }
      golfActingScope={golfActingScope}
      projectionSnapshot={projectionBundle.snapshot}
      playerMap={projectionBundle.playerMap}
      projectionScoring={projectionBundle.scoring}
      toolsView={toolsView}
      baseballToolsView={baseballToolsView}
      baseballTrailingWindow={baseballTrailingWindow}
      hockeyToolsView={hockeyToolsView}
      proSchedule={proSchedule}
      toolsTeamA={a != null && !Number.isNaN(a) ? a : undefined}
      toolsTeamB={b != null && !Number.isNaN(b) ? b : undefined}
      toolsTeamId={
        tab === "tools" && team != null && !Number.isNaN(team)
          ? team
          : undefined
      }
      draftSlot={draftSlot}
      availableDraftSlots={availableDraftSlots}
      draftSimSnapshot={draftSimSnapshot}
      weeklyProjectionSnapshot={weeklyProjectionSnapshot}
      playoffOddsSnapshot={playoffOddsSnapshot}
      playoffOddsSamples={playoffOddsSamples}
      boxPair={boxPair}
      weekBoxScore={weekBoxScore}
      viewerTeamId={viewerTeamId}
      scoringSandbox={scoringSandbox}
      baseballAnalysis={baseballAnalysis}
      analysisSeriesMode={analysisSeriesMode}
      hockeyNhl={hockeyNhl}
      hockeyValues={hockeyValues}
      hockeyBoardQuery={hockeyBoardQuery}
      hockeySchedule={hockeySchedule}
      hockeyDecisionQuery={league.sport === "hockey" ? hockeyDecisionQuery : undefined}
      hockeyTeamStrength={hockeyTeamStrength}
      hockeyInjuryLog={hockeyInjuryLog}
    />
  );
}
