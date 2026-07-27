import Link from "next/link";
import type { LeagueSnapshot, Player, Team } from "@/lib/data";
import { formatStat, isPitcher, stat } from "@/lib/baseball";
import {
  injuryTone,
  recordLabel,
  sportFormatLabel,
  winPctLabel,
} from "@/lib/league";

function SeasonSwitcher({
  leagueId,
  seasons,
  current,
  tab,
  role,
}: {
  leagueId: string;
  seasons: number[];
  current: number;
  tab: string;
  role?: string;
}) {
  if (seasons.length <= 1) return null;
  return (
    <div className="season-switch" aria-label="Season">
      {seasons.map((season) => {
        const href =
          `/leagues/${leagueId}?season=${season}&tab=${tab}` +
          (role ? `&role=${role}` : "");
        return (
          <Link
            key={season}
            href={href}
            className={`season-chip${season === current ? " active" : ""}`}
          >
            {season}
          </Link>
        );
      })}
    </div>
  );
}

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

function StatusDot({ player }: { player: Player }) {
  const tone = injuryTone(player);
  const label = player.injury_status || player.status || "OK";
  return <span className={`status-dot ${tone}`} title={label} />;
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

function FootballPlayersTable({ players }: { players: Player[] }) {
  return (
    <div className="panel table-scroll">
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Player</th>
            <th>Pos</th>
            <th>Pro</th>
            <th>Fantasy</th>
            <th>FPts</th>
          </tr>
        </thead>
        <tbody>
          {players.map((player) => (
            <tr key={`${player.id}-${player.name}`}>
              <td>
                <StatusDot player={player} />
              </td>
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
  );
}

function BaseballPlayersTable({
  players,
  role,
}: {
  players: Player[];
  role: string;
}) {
  return (
    <div className="panel table-scroll">
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Player</th>
            <th>Pos</th>
            <th>Team</th>
            <th>Fantasy</th>
            {role !== "pitcher" ? (
              <>
                <th>R</th>
                <th>HR</th>
                <th>RBI</th>
                <th>SB</th>
                <th>AVG</th>
                <th>OPS</th>
              </>
            ) : null}
            {role !== "batter" ? (
              <>
                <th>IP</th>
                <th>W</th>
                <th>SV</th>
                <th>K</th>
                <th>ERA</th>
                <th>WHIP</th>
              </>
            ) : null}
            <th>FPts</th>
          </tr>
        </thead>
        <tbody>
          {players.map((player) => {
            const pitcher = isPitcher(player);
            return (
              <tr key={`${player.id}-${player.name}`}>
                <td>
                  <StatusDot player={player} />
                </td>
                <td>{player.name}</td>
                <td>{player.position ?? "—"}</td>
                <td>{player.pro_team ?? "—"}</td>
                <td>{player.fantasy_team ?? "—"}</td>
                {role !== "pitcher" ? (
                  <>
                    <td>{pitcher && role === "all" ? "—" : formatStat(stat(player, "R"))}</td>
                    <td>{pitcher && role === "all" ? "—" : formatStat(stat(player, "HR"))}</td>
                    <td>{pitcher && role === "all" ? "—" : formatStat(stat(player, "RBI"))}</td>
                    <td>{pitcher && role === "all" ? "—" : formatStat(stat(player, "SB"))}</td>
                    <td>
                      {pitcher && role === "all"
                        ? "—"
                        : formatStat(stat(player, "AVG"), 3)}
                    </td>
                    <td>
                      {pitcher && role === "all"
                        ? "—"
                        : formatStat(stat(player, "OPS"), 3)}
                    </td>
                  </>
                ) : null}
                {role !== "batter" ? (
                  <>
                    <td>
                      {!pitcher && role === "all" ? "—" : formatStat(stat(player, "IP"), 1)}
                    </td>
                    <td>
                      {!pitcher && role === "all" ? "—" : formatStat(stat(player, "W"))}
                    </td>
                    <td>
                      {!pitcher && role === "all" ? "—" : formatStat(stat(player, "SV"))}
                    </td>
                    <td>
                      {!pitcher && role === "all" ? "—" : formatStat(stat(player, "K"))}
                    </td>
                    <td>
                      {!pitcher && role === "all"
                        ? "—"
                        : formatStat(stat(player, "ERA"), 2)}
                    </td>
                    <td>
                      {!pitcher && role === "all"
                        ? "—"
                        : formatStat(stat(player, "WHIP"), 2)}
                    </td>
                  </>
                ) : null}
                <td>{player.total_points?.toFixed?.(1) ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function LeagueView({
  league,
  seasons,
  tab,
  role = "all",
}: {
  league: LeagueSnapshot;
  seasons: number[];
  tab: string;
  role?: string;
}) {
  const leagueId = league.league_id;
  const isBaseball = league.sport === "baseball";
  const period = league.period_label || (isBaseball ? "period" : "week");
  const active = ["standings", "teams", "players"].includes(tab) ? tab : "standings";
  const activeRole = isBaseball ? role : undefined;

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
        . Standings, rosters, and season stats from ESPN.
      </p>

      <SeasonSwitcher
        leagueId={leagueId}
        seasons={seasons}
        current={league.season}
        tab={active}
        role={active === "players" ? activeRole : undefined}
      />

      <div className="tabs">
        {(["standings", "teams", "players"] as const).map((name) => (
          <Link
            key={name}
            href={
              `/leagues/${leagueId}?season=${league.season}&tab=${name}` +
              (name === "players" && activeRole ? `&role=${activeRole}` : "")
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
          {isBaseball ? (
            <BaseballPlayersTable players={players} role={role} />
          ) : (
            <FootballPlayersTable players={players} />
          )}
        </>
      ) : null}
    </main>
  );
}
