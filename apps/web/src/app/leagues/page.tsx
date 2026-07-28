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
      <h2>Leagues</h2>
      <p className="lede">
        Every active Strictly Jayers league on ESPN. Open one for standings,
        matchups, history, and rosters.
      </p>
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
            Run <code>sj sync</code> with ESPN credentials, or{" "}
            <code>sj seed</code> / committed fixtures for local development.
          </EmptyState>
        ) : null}
      </div>
    </main>
  );
}
