import Link from "next/link";
import { getLatestLeagues } from "@/lib/data";

/**
 * Snapshots are a Cloud Storage mount that only exists at runtime -- the image
 * is built with just the fixtures. Prerendering this page would bake those
 * fixtures in permanently, so every visitor would see sample data no matter
 * how often sj-sync ran.
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const leagues = await getLatestLeagues();

  return (
    <main>
      <section className="hero">
        <div className="hero-brand">Strictly Jayers</div>
        <h1>Leagues, teams, and players in one place.</h1>
        <p>
          The member hub for Strictly Jayers fantasy sports — football, baseball,
          and the seasons that built the group.
        </p>
        <div className="cta-row">
          <Link className="button" href="/leagues">
            Enter leagues
          </Link>
          <Link className="button secondary" href={leagues[0] ? `/leagues/${leagues[0].league_id}` : "/leagues"}>
            Open latest season
          </Link>
        </div>
      </section>
    </main>
  );
}
