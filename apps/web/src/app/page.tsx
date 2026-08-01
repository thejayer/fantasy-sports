import Link from "next/link";

import { MemberDashboard } from "@/components/MemberDashboard";
import {
  getLeagueIndex,
  getLeagueSnapshot,
  getPlayoffOddsSnapshot,
} from "@/lib/data";
import {
  buildLeagueCard,
  homeAvailableSeasons,
  leaguesAtSeason,
  resolveHomeSeason,
  type HomeLeagueCard,
} from "@/lib/member-home";
import { withPlayoffOdds } from "@/lib/portfolio";
import { getViewer } from "@/lib/viewer";

/**
 * Snapshots are a Cloud Storage mount that only exists at runtime -- the image
 * is built with just the fixtures. Prerendering this page would bake those
 * fixtures in permanently, so every visitor would see sample data no matter
 * how often sj-sync ran.
 */
export const dynamic = "force-dynamic";

/** Signed-out / unlinked front door. */
function Hero({ firstLeagueId }: { firstLeagueId?: string }) {
  return (
    <main>
      <section className="hero">
        <div className="hero-brand">Strictly Jayers</div>
        <h1>Leagues, teams, and players in one place.</h1>
        <p>
          The member hub for Strictly Jayers fantasy sports — football, baseball,
          golf, and the seasons that built the group.
        </p>
        <div className="cta-row">
          <Link className="button" href="/leagues">
            Enter leagues
          </Link>
          <Link
            className="button secondary"
            href={firstLeagueId ? `/leagues/${firstLeagueId}` : "/leagues"}
          >
            Open latest season
          </Link>
        </div>
      </section>
    </main>
  );
}

type Props = {
  searchParams: Promise<{ season?: string }>;
};

export default async function HomePage({ searchParams }: Props) {
  const { season: seasonParam } = await searchParams;
  const requested = seasonParam ? Number(seasonParam) : undefined;
  const index = await getLeagueIndex();
  const seasons = homeAvailableSeasons(index);
  const season = resolveHomeSeason(
    seasons,
    requested != null && Number.isFinite(requested) ? requested : undefined,
  );
  const leagues = season != null ? leaguesAtSeason(index, season) : [];
  const viewer = await getViewer();

  // Without a linked franchise the dashboard has nothing personal to say, so
  // keep the hero as the front door rather than shipping a wall of empty cards.
  if (!viewer.franchises.length) {
    return <Hero firstLeagueId={leagues[0]?.league_id} />;
  }

  const cards: HomeLeagueCard[] = [];
  for (const item of leagues) {
    const league = await getLeagueSnapshot(item.league_id, item.season);
    if (!league) continue;
    const link = viewer.franchises.find(
      (franchise) => franchise.league_id === item.league_id,
    );
    const teamId = league.teams.some((team) => team.team_id === link?.team_id)
      ? link!.team_id
      : undefined;
    let card = buildLeagueCard(league, teamId);
    if (league.sport === "football" && teamId != null) {
      const odds = await getPlayoffOddsSnapshot(league.league_id, league.season);
      card = withPlayoffOdds(card, odds);
    }
    cards.push(card);
  }

  if (!cards.length) {
    return <Hero firstLeagueId={leagues[0]?.league_id} />;
  }

  // Linked leagues first — the unlinked ones are informational.
  cards.sort((a, b) => {
    if (Boolean(a.team) !== Boolean(b.team)) return a.team ? -1 : 1;
    return a.sport.localeCompare(b.sport) || a.name.localeCompare(b.name);
  });

  return (
    <MemberDashboard
      cards={cards}
      seasons={seasons}
      currentSeason={season ?? cards[0]!.season}
      memberName={
        viewer.displayName ??
        viewer.name?.split("@")[0] ??
        null
      }
    />
  );
}
