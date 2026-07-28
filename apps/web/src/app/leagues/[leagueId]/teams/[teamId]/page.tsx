import Link from "next/link";
import { notFound } from "next/navigation";
import { BaseballRosterView } from "@/components/BaseballRosterView";
import { SeasonSwitcher } from "@/components/SeasonSwitcher";
import { getLeagueSeasons, getTeam } from "@/lib/data";
import { injuryTone, recordLabel, winPctLabel } from "@/lib/league";

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
  const seasons = await getLeagueSeasons(leagueId);

  const result = await getTeam(
    leagueId,
    parsedId,
    season && !Number.isNaN(season) ? season : undefined,
  );
  if (!result) {
    notFound();
  }

  const { league, team } = result;
  const seasonHref = (year: number) =>
    `/leagues/${leagueId}/teams/${team.team_id}?season=${year}`;

  if (league.sport === "baseball") {
    return (
      <BaseballRosterView
        league={league}
        team={team}
        seasons={seasons}
      />
    );
  }

  return (
    <main className="section league-view sport-football">
      <div className="league-kicker">
        <Link
          className="league-meta"
          href={`/leagues/${leagueId}?season=${league.season}`}
        >
          {league.name}
        </Link>
        <span className="league-meta">season {league.season}</span>
      </div>
      <h2>{team.name}</h2>
      <p className="lede">
        {team.owners.join(", ") || "Owner TBD"} · {recordLabel(team)} (
        {winPctLabel(team)}) · {team.roster.length} rostered
      </p>

      <SeasonSwitcher
        seasons={seasons}
        current={league.season}
        hrefFor={seasonHref}
      />

      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Player</th>
              <th>Pos</th>
              <th>Slot</th>
              <th>Pro</th>
              <th>Status</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {team.roster.map((player) => {
              const label = player.injury_status || player.status || "OK";
              return (
                <tr key={`${player.id}-${player.name}`}>
                  <td>
                    <span
                      className={`status-dot ${injuryTone(player)}`}
                      title={label}
                    />
                  </td>
                  <td>{player.name}</td>
                  <td>{player.position ?? "—"}</td>
                  <td>{player.slot ?? "—"}</td>
                  <td>{player.pro_team ?? "—"}</td>
                  <td>{player.injury_status ?? "—"}</td>
                  <td>{player.total_points?.toFixed?.(1) ?? "—"}</td>
                </tr>
              );
            })}
            {!team.roster.length ? (
              <tr>
                <td colSpan={7}>No roster players in this snapshot.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
