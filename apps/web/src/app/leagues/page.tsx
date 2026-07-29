import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { getLatestLeagues } from "@/lib/data";

// See app/page.tsx: prerendering would freeze this list at the build-time
// fixtures instead of reflecting the synced snapshots.
export const dynamic = "force-dynamic";

export default async function LeaguesPage() {
  const leagues = await getLatestLeagues();

  return (
    <main className="section">
      <div className="section-head">
        <div>
          <h2>Leagues</h2>
          <p className="lede">
            Strictly Jayers leagues — ESPN football/baseball snapshots plus
            hub-native golf. Open one for standings, history, and rosters.
          </p>
        </div>
        <Link className="button" href="/leagues/new">
          Create golf league
        </Link>
      </div>
      <div className="league-list">
        {leagues.map((league) => (
          <Link
            key={league.league_id}
            className="league-link"
            href={`/leagues/${league.league_id}`}
          >
            <div>
              <strong>{league.name}</strong>
              <div className="league-meta">
                {league.sport} · {league.format} · season {league.season} ·{" "}
                {league.team_count} teams
              </div>
            </div>
            <span className="pill">{league.format}</span>
          </Link>
        ))}
        {!leagues.length ? (
          <EmptyState title="No league snapshots yet">
            Run <code>sj sync</code> with ESPN credentials,{" "}
            <code>sj seed</code> / committed fixtures, or create a golf league.
          </EmptyState>
        ) : null}
      </div>
    </main>
  );
}
