import Link from "next/link";
import { notFound } from "next/navigation";
import { BaseballRosterView } from "@/components/BaseballLeagueView";
import { getTeam } from "@/lib/data";

// See app/page.tsx. Already dynamic today, but declared so adding
// generateStaticParams later cannot silently freeze snapshot data.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ leagueId: string; teamId: string }>;
  searchParams: Promise<{ season?: string }>;
};

export default async function TeamPage({ params, searchParams }: Props) {
  const { leagueId, teamId } = await params;
  const { season: seasonParam } = await searchParams;
  const parsedId = Number(teamId);
  if (Number.isNaN(parsedId)) {
    notFound();
  }
  const season = seasonParam ? Number(seasonParam) : undefined;

  const result = await getTeam(
    leagueId,
    parsedId,
    season && !Number.isNaN(season) ? season : undefined,
  );
  if (!result) {
    notFound();
  }

  const { league, team } = result;

  if (league.sport === "baseball") {
    return <BaseballRosterView league={league} team={team} />;
  }

  return (
    <main className="section">
      <div className="league-meta" style={{ marginBottom: "0.35rem" }}>
        <Link href={`/leagues/${leagueId}`}>{league.name}</Link>
        {" · "}
        season {league.season}
      </div>
      <h2>{team.name}</h2>
      <p className="lede">
        {team.owners.join(", ") || "Owner TBD"} · {team.wins}-{team.losses}
        {team.ties ? `-${team.ties}` : ""} · {team.roster.length} rostered players
      </p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th>Slot</th>
              <th>Pro</th>
              <th>Status</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {team.roster.map((player) => (
              <tr key={`${player.id}-${player.name}`}>
                <td>{player.name}</td>
                <td>{player.position ?? "—"}</td>
                <td>{player.slot ?? "—"}</td>
                <td>{player.pro_team ?? "—"}</td>
                <td>{player.injury_status ?? "—"}</td>
                <td>{player.total_points?.toFixed?.(1) ?? "—"}</td>
              </tr>
            ))}
            {!team.roster.length ? (
              <tr>
                <td colSpan={6}>No roster players in this snapshot.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
