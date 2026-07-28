import Link from "next/link";
import { MatchupsPanel, type MatchupsView } from "@/components/MatchupsPanel";
import { PlayersDataTable } from "@/components/PlayersDataTable";
import { SeasonSwitcher } from "@/components/SeasonSwitcher";
import type { LeagueSnapshot, Team } from "@/lib/data";
import { isPitcher } from "@/lib/baseball";
import {
  recordLabel,
  sportFormatLabel,
  winPctLabel,
} from "@/lib/league";

function RoleSwitcher({
  leagueId,
  season,
  tab,
  role,
}: {
  leagueId: string;
  season: number;
  tab: string;
  role: string;
}) {
  const roles = [
    { id: "all", label: "All" },
    { id: "batter", label: "Batters" },
    { id: "pitcher", label: "Pitchers" },
  ];
  return (
    <div className="tabs" style={{ marginTop: "0.5rem" }}>
      {roles.map((item) => (
        <Link
          key={item.id}
          href={`/leagues/${leagueId}?season=${season}&tab=${tab}&role=${item.id}`}
          className={`tab${role === item.id ? " active" : ""}`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

function StandingsTable({
  league,
  leagueId,
}: {
  league: LeagueSnapshot;
  leagueId: string;
}) {
  const isFootball = league.sport === "football";
  const showPoints = league.teams.some((team) => team.points_for != null);
  const showAgainst = isFootball;

  return (
    <div className="panel table-scroll">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>Owner</th>
            <th>Record</th>
            <th>Win%</th>
            {isFootball || showPoints ? <th>{isFootball ? "PF" : "Points"}</th> : null}
            {showAgainst ? <th>PA</th> : null}
          </tr>
        </thead>
        <tbody>
          {league.teams.map((team) => (
            <tr key={team.team_id}>
              <td>{team.standing ?? "—"}</td>
              <td>
                <Link
                  href={`/leagues/${leagueId}/teams/${team.team_id}?season=${league.season}`}
                >
                  {team.name}
                </Link>
              </td>
              <td>{team.owners.join(", ") || "—"}</td>
              <td>{recordLabel(team)}</td>
              <td>{winPctLabel(team)}</td>
              {isFootball || showPoints ? (
                <td>{team.points_for?.toFixed?.(1) ?? "—"}</td>
              ) : null}
              {showAgainst ? (
                <td>{team.points_against?.toFixed?.(1) ?? "—"}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamsList({
  league,
  leagueId,
}: {
  league: LeagueSnapshot;
  leagueId: string;
}) {
  return (
    <div className="league-list">
      {league.teams.map((team: Team) => (
        <Link
          key={team.team_id}
          className="league-link"
          href={`/leagues/${leagueId}/teams/${team.team_id}?season=${league.season}`}
        >
          <div>
            <strong>{team.name}</strong>
            <div className="league-meta">
              {team.owners.join(", ") || "No owner listed"} · {recordLabel(team)}{" "}
              ({winPctLabel(team)})
            </div>
          </div>
          <span className="pill">{team.roster.length} on roster</span>
        </Link>
      ))}
    </div>
  );
}

export function LeagueView({
  league,
  seasons,
  tab,
  role = "all",
  week,
  matchupsView = "week",
}: {
  league: LeagueSnapshot;
  seasons: number[];
  tab: string;
  role?: string;
  week?: number;
  matchupsView?: MatchupsView;
}) {
  const leagueId = league.league_id;
  const isBaseball = league.sport === "baseball";
  const period = league.period_label || (isBaseball ? "period" : "week");
  const active = ["standings", "teams", "players", "matchups"].includes(tab)
    ? tab
    : "standings";
  const activeRole = isBaseball ? role : undefined;

  const seasonHrefExtra =
    active === "players" && activeRole
      ? `&role=${activeRole}`
      : active === "matchups"
        ? `&view=${matchupsView}${week != null ? `&week=${week}` : ""}`
        : "";

  const players = isBaseball
    ? league.players.filter((player) => {
        if (role === "batter") return !isPitcher(player);
        if (role === "pitcher") return isPitcher(player);
        return true;
      })
    : league.players;

  return (
    <main className={`section league-view sport-${league.sport}`}>
      <div className="league-kicker">
        <span className="pill sport-pill">
          {sportFormatLabel(league.sport, league.format)}
        </span>
        <span className="league-meta">
          season {league.season}
          {league.current_week ? ` · ${period} ${league.current_week}` : ""}
          {league.scoring_type ? ` · ${league.scoring_type}` : ""}
        </span>
      </div>
      <h2>{league.name}</h2>
      <p className="lede">
        {league.team_count} teams
        {league.synced_at
          ? ` · synced ${new Date(league.synced_at).toLocaleString()}`
          : ""}
        . Standings, matchups, rosters, and season stats from ESPN.
      </p>

      <SeasonSwitcher
        seasons={seasons}
        current={league.season}
        hrefFor={(season) =>
          `/leagues/${leagueId}?season=${season}&tab=${active}${seasonHrefExtra}`
        }
      />

      <div className="tabs">
        {(["standings", "teams", "players", "matchups"] as const).map((name) => (
          <Link
            key={name}
            href={
              `/leagues/${leagueId}?season=${league.season}&tab=${name}` +
              (name === "players" && activeRole ? `&role=${activeRole}` : "") +
              (name === "matchups"
                ? `&view=${matchupsView}${week != null ? `&week=${week}` : ""}`
                : "")
            }
            className={`tab${active === name ? " active" : ""}`}
          >
            {name}
          </Link>
        ))}
      </div>

      {active === "standings" ? (
        <StandingsTable league={league} leagueId={leagueId} />
      ) : null}

      {active === "teams" ? <TeamsList league={league} leagueId={leagueId} /> : null}

      {active === "players" ? (
        <>
          {isBaseball ? (
            <RoleSwitcher
              leagueId={leagueId}
              season={league.season}
              tab="players"
              role={role}
            />
          ) : null}
          <PlayersDataTable
            players={players}
            sport={league.sport}
            role={role}
          />
        </>
      ) : null}

      {active === "matchups" ? (
        <MatchupsPanel league={league} week={week} view={matchupsView} />
      ) : null}
    </main>
  );
}
