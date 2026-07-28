import { notFound } from "next/navigation";
import { LeagueView } from "@/components/LeagueView";
import type { MatchupsView } from "@/components/MatchupsPanel";
import { getLeagueSeasons, getLeagueSnapshot } from "@/lib/data";

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
  } = await searchParams;
  const seasons = await getLeagueSeasons(leagueId);
  const season = seasonParam ? Number(seasonParam) : undefined;
  const week = weekParam ? Number(weekParam) : undefined;
  const matchupsView = (
    ["week", "schedule", "playoffs"].includes(viewParam ?? "")
      ? viewParam
      : "week"
  ) as MatchupsView;
  const league = await getLeagueSnapshot(
    leagueId,
    season && !Number.isNaN(season) ? season : undefined,
  );
  if (!league) {
    notFound();
  }

  return (
    <LeagueView
      league={league}
      seasons={seasons}
      tab={tab}
      role={["all", "batter", "pitcher"].includes(role) ? role : "all"}
      week={week != null && !Number.isNaN(week) ? week : undefined}
      matchupsView={matchupsView}
    />
  );
}
