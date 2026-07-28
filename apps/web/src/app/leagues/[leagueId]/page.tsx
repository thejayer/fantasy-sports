import { notFound } from "next/navigation";
import type { HistoryView } from "@/components/HistoryPanel";
import { LeagueView } from "@/components/LeagueView";
import type { MatchupsView } from "@/components/MatchupsPanel";
import type { ToolsView } from "@/components/ToolsPanel";
import {
  getDraftSimSnapshot,
  getLeagueHistoryArchive,
  getLeagueSeasons,
  getLeagueSnapshot,
  getPlayerMap,
  getProjectionSnapshot,
  getWeeklyProjectionSnapshot,
  type DraftSimSnapshot,
  type PlayerMapSnapshot,
  type ProjectionSnapshot,
  type WeeklyProjectionSnapshot,
} from "@/lib/data";
import {
  projectionSeasonCandidates,
  scoringSlugFromLeague,
} from "@/lib/projection-join";

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
    scoring?: string;
    slot?: string;
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
    scoring: scoringParam,
    slot: slotParam,
  } = await searchParams;
  const seasons = await getLeagueSeasons(leagueId);
  const season = seasonParam ? Number(seasonParam) : undefined;
  const week = weekParam ? Number(weekParam) : undefined;
  const a = aParam ? Number(aParam) : undefined;
  const b = bParam ? Number(bParam) : undefined;
  const slot = slotParam ? Number(slotParam) : 1;

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
  const toolsView = (
    ["trade", "waivers", "strength", "draft", "start-sit", "deferred"].includes(
      viewParam ?? "",
    )
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
  if (
    league.sport === "football" &&
    tab === "tools" &&
    toolsView === "draft"
  ) {
    const scoring = projectionBundle.scoring ?? scoringSlugFromLeague(league);
    const draftSlot =
      slot != null && !Number.isNaN(slot) && slot >= 1 ? Math.trunc(slot) : 1;
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
      projectionSnapshot={projectionBundle.snapshot}
      playerMap={projectionBundle.playerMap}
      projectionScoring={projectionBundle.scoring}
      toolsView={toolsView}
      draftSlot={slot != null && !Number.isNaN(slot) && slot >= 1 ? Math.trunc(slot) : 1}
      draftSimSnapshot={draftSimSnapshot}
      weeklyProjectionSnapshot={weeklyProjectionSnapshot}
    />
  );
}
