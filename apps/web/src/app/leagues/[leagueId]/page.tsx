import { notFound } from "next/navigation";
import type { HistoryView } from "@/components/HistoryPanel";
import { LeagueView } from "@/components/LeagueView";
import type { MatchupsView } from "@/components/MatchupsPanel";
import {
  getLeagueHistoryArchive,
  getLeagueSeasons,
  getLeagueSnapshot,
} from "@/lib/data";

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
  }>;
};

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
  } = await searchParams;
  const seasons = await getLeagueSeasons(leagueId);
  const season = seasonParam ? Number(seasonParam) : undefined;
  const week = weekParam ? Number(weekParam) : undefined;
  const a = aParam ? Number(aParam) : undefined;
  const b = bParam ? Number(bParam) : undefined;

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

  const league = await getLeagueSnapshot(
    leagueId,
    season && !Number.isNaN(season) ? season : undefined,
  );
  if (!league) {
    notFound();
  }

  const historyArchive =
    tab === "history" ? await getLeagueHistoryArchive(leagueId) : null;

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
    />
  );
}
