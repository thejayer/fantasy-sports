import { notFound } from "next/navigation";
import type { HistoryView } from "@/components/HistoryPanel";
import { LeagueView } from "@/components/LeagueView";
import type { MatchupsView } from "@/components/MatchupsPanel";
import type { ToolsView } from "@/components/ToolsPanel";
import type { ActivityView } from "@/lib/activity";
import {
  getDraftSimSnapshot,
  getLeagueHistoryArchive,
  getLeagueSeasons,
  getLeagueSnapshot,
  getPlayerMap,
  getPlayoffOddsSnapshot,
  getProjectionSnapshot,
  getWeeklyProjectionSnapshot,
  listDraftSimSlots,
  type DraftSimSnapshot,
  type PlayerMapSnapshot,
  type PlayoffOddsSnapshot,
  type ProjectionSnapshot,
  type WeeklyProjectionSnapshot,
} from "@/lib/data";
import {
  projectionSeasonCandidates,
  scoringSlugFromLeague,
} from "@/lib/projection-join";
import { resolveGolfActingScope } from "@/lib/franchise-acl";
import { getViewerTeamId } from "@/lib/viewer";

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
    ["standings", "champions", "records", "h2h"].includes(viewParam ?? "")
      ? viewParam
      : "standings"
  ) as HistoryView;
  const activityView = (
    ["all", "trades", "waivers"].includes(viewParam ?? "")
      ? viewParam
      : "all"
  ) as ActivityView;
  const toolsView = (
    [
      "trade",
      "waivers",
      "strength",
      "draft",
      "start-sit",
      "playoff-odds",
    ].includes(viewParam ?? "")
      ? viewParam
      : "trade"
  ) as ToolsView;

  const league = await getLeagueSnapshot(
    leagueId,
    season && !Number.isNaN(season) ? season : undefined,
  );
  if (!league) {
    notFound();
  }

  const historyArchive =
    tab === "history" ? await getLeagueHistoryArchive(leagueId) : null;

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
  if (
    league.sport === "football" &&
    tab === "tools" &&
    toolsView === "playoff-odds"
  ) {
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

  const golfActingScope =
    league.sport === "golf" && (tab === "lineup" || tab === "auction")
      ? await resolveGolfActingScope(
          league.league_id,
          league.teams.map((t) => t.team_id),
        )
      : undefined;

  // Only meaningful when the franchise is in this season's snapshot — a member
  // linked to a team that did not exist in 2016 must not highlight team_id 4.
  const linkedTeamId = await getViewerTeamId(leagueId);
  const viewerTeamId = league.teams.some((t) => t.team_id === linkedTeamId)
    ? linkedTeamId
    : undefined;

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
      viewerTeamId={viewerTeamId}
    />
  );
}
