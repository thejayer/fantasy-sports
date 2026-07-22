import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeagueSnapshot } from "@/lib/data";

type Props = {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

function record(team: {
  wins: number;
  losses: number;
  ties: number;
}): string {
  return team.ties ? `${team.wins}-${team.losses}-${team.ties}` : `${team.wins}-${team.losses}`;
}

export default async function LeagueDetailPage({ params, searchParams }: Props) {
  const { leagueId } = await params;
  const { tab = "standings" } = await searchParams;
  const league = await getLeagueSnapshot(leagueId);
  if (!league) {
    notFound();
  }

  const active = ["standings", "teams", "players"].includes(tab) ? tab : "standings";

  return (
    <main className="section">
      <div className="league-meta" style={{ marginBottom: "0.35rem" }}>
        {league.sport} · {league.format} · season {league.season}
      </div>
      <h2>{league.name}</h2>
      <p className="lede">
        {league.team_count} teams
        {league.current_week ? ` · week ${league.current_week}` : ""}.
        {league.synced_at ? ` Synced ${new Date(league.synced_at).toLocaleString()}.` : ""}
      </p>

      <div className="tabs">
        {(["standings", "teams", "players"] as const).map((name) => (
          <Link
            key={name}
            href={`/leagues/${leagueId}?tab=${name}`}
            className={`tab${active === name ? " active" : ""}`}
          >
            {name}
          </Link>
        ))}
      </div>

      {active === "standings" ? (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Owner</th>
                <th>Record</th>
                <th>PF</th>
                <th>PA</th>
              </tr>
            </thead>
            <tbody>
              {league.teams.map((team) => (
                <tr key={team.team_id}>
                  <td>{team.standing ?? "—"}</td>
                  <td>
                    <Link href={`/leagues/${leagueId}/teams/${team.team_id}`}>
                      {team.name}
                    </Link>
                  </td>
                  <td>{team.owners.join(", ") || "—"}</td>
                  <td>{record(team)}</td>
                  <td>{team.points_for?.toFixed?.(1) ?? "—"}</td>
                  <td>{team.points_against?.toFixed?.(1) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {active === "teams" ? (
        <div className="league-list">
          {league.teams.map((team) => (
            <Link
              key={team.team_id}
              className="league-link"
              href={`/leagues/${leagueId}/teams/${team.team_id}`}
            >
              <div>
                <strong>{team.name}</strong>
                <div className="league-meta">
                  {team.owners.join(", ") || "No owner listed"} · {record(team)}
                </div>
              </div>
              <span className="pill">{team.roster.length} players</span>
            </Link>
          ))}
        </div>
      ) : null}

      {active === "players" ? (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Pos</th>
                <th>Pro</th>
                <th>Fantasy team</th>
                <th>Points</th>
              </tr>
            </thead>
            <tbody>
              {league.players.map((player) => (
                <tr key={`${player.id}-${player.name}`}>
                  <td>{player.name}</td>
                  <td>{player.position ?? "—"}</td>
                  <td>{player.pro_team ?? "—"}</td>
                  <td>{player.fantasy_team ?? "—"}</td>
                  <td>{player.total_points?.toFixed?.(1) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
