import Link from "next/link";
import { getLatestLeagues } from "@/lib/data";

export default async function LeaguesPage() {
  const leagues = await getLatestLeagues();

  return (
    <main className="section">
      <h2>Leagues</h2>
      <p className="lede">
        Every active Strictly Jayers league on ESPN. Open one for standings, teams,
        rosters, and players.
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
          <p className="muted">
            No league snapshots yet. Run <code>sj sync</code> with ESPN credentials,
            or keep using the committed fixtures for local development.
          </p>
        ) : null}
      </div>
    </main>
  );
}
