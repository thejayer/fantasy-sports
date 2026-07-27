import Link from "next/link";
import type { LeagueSnapshot, Player } from "@/lib/data";
import {
  formatStat,
  injuryTone,
  isPitcher,
  recordLabel,
  sortRoster,
  stat,
  winPctLabel,
} from "@/lib/baseball";

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

export function BaseballLeagueView({
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
  const period = league.period_label || "period";
  const active = ["standings", "teams", "players"].includes(tab) ? tab : "standings";
  const showPoints = league.teams.some((team) => team.points_for != null);

  const players = league.players.filter((player) => {
    if (role === "batter") return !isPitcher(player);
    if (role === "pitcher") return isPitcher(player);
    return true;
  });

  return (
    <main className="section baseball-league">
      <div className="league-kicker">
        <span className="pill sport-pill">Baseball · Dynasty</span>
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
        . Standings, rosters, and season counting stats from ESPN.
      </p>

      <SeasonSwitcher
        leagueId={leagueId}
        seasons={seasons}
        current={league.season}
        tab={active}
        role={role}
      />

      <div className="tabs">
        {(["standings", "teams", "players"] as const).map((name) => (
          <Link
            key={name}
            href={`/leagues/${leagueId}?season=${league.season}&tab=${name}${
              name === "players" ? `&role=${role}` : ""
            }`}
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
                <th>Win%</th>
                {showPoints ? <th>Points</th> : null}
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
                  {showPoints ? (
                    <td>{team.points_for?.toFixed?.(1) ?? "—"}</td>
                  ) : null}
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
      ) : null}

      {active === "players" ? (
        <>
          <RoleSwitcher
            leagueId={leagueId}
            season={league.season}
            tab="players"
            role={role}
          />
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
        </>
      ) : null}
    </main>
  );
}

export function BaseballRosterView({
  league,
  team,
}: {
  league: LeagueSnapshot;
  team: LeagueSnapshot["teams"][number];
}) {
  const roster = sortRoster(team.roster);
  const batters = roster.filter((player) => !isPitcher(player));
  const pitchers = roster.filter((player) => isPitcher(player));

  return (
    <main className="section baseball-league">
      <div className="league-kicker">
        <Link className="league-meta" href={`/leagues/${league.league_id}?season=${league.season}`}>
          {league.name}
        </Link>
        <span className="league-meta">season {league.season}</span>
      </div>
      <h2>{team.name}</h2>
      <p className="lede">
        {team.owners.join(", ") || "Owner TBD"} · {recordLabel(team)} (
        {winPctLabel(team)}) · {team.roster.length} rostered
      </p>

      <RosterGroup title="Batters" players={batters} kind="batter" />
      <RosterGroup title="Pitchers" players={pitchers} kind="pitcher" />
    </main>
  );
}

function RosterGroup({
  title,
  players,
  kind,
}: {
  title: string;
  players: Player[];
  kind: "batter" | "pitcher";
}) {
  if (!players.length) return null;
  return (
    <div style={{ marginTop: "1.5rem" }}>
      <h3 className="roster-group-title">{title}</h3>
      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Slot</th>
              <th>Player</th>
              <th>Pos</th>
              <th>Pro</th>
              {kind === "batter" ? (
                <>
                  <th>R</th>
                  <th>HR</th>
                  <th>RBI</th>
                  <th>SB</th>
                  <th>AVG</th>
                  <th>OPS</th>
                </>
              ) : (
                <>
                  <th>IP</th>
                  <th>W</th>
                  <th>SV</th>
                  <th>K</th>
                  <th>ERA</th>
                  <th>WHIP</th>
                </>
              )}
              <th>FPts</th>
            </tr>
          </thead>
          <tbody>
            {players.map((player) => (
              <tr key={`${player.id}-${player.name}`}>
                <td>
                  <StatusDot player={player} />
                </td>
                <td>{player.slot ?? "—"}</td>
                <td>{player.name}</td>
                <td>{player.position ?? "—"}</td>
                <td>{player.pro_team ?? "—"}</td>
                {kind === "batter" ? (
                  <>
                    <td>{formatStat(stat(player, "R"))}</td>
                    <td>{formatStat(stat(player, "HR"))}</td>
                    <td>{formatStat(stat(player, "RBI"))}</td>
                    <td>{formatStat(stat(player, "SB"))}</td>
                    <td>{formatStat(stat(player, "AVG"), 3)}</td>
                    <td>{formatStat(stat(player, "OPS"), 3)}</td>
                  </>
                ) : (
                  <>
                    <td>{formatStat(stat(player, "IP"), 1)}</td>
                    <td>{formatStat(stat(player, "W"))}</td>
                    <td>{formatStat(stat(player, "SV"))}</td>
                    <td>{formatStat(stat(player, "K"))}</td>
                    <td>{formatStat(stat(player, "ERA"), 2)}</td>
                    <td>{formatStat(stat(player, "WHIP"), 2)}</td>
                  </>
                )}
                <td>{player.total_points?.toFixed?.(1) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
