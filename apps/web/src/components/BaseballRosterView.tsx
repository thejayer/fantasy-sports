import Link from "next/link";
import type { LeagueSnapshot, Player } from "@/lib/data";
import {
  formatStat,
  isPitcher,
  recordLabel,
  sortRoster,
  stat,
  winPctLabel,
} from "@/lib/baseball";
import { injuryTone } from "@/lib/league";

function StatusDot({ player }: { player: Player }) {
  const tone = injuryTone(player);
  const label = player.injury_status || player.status || "OK";
  return <span className={`status-dot ${tone}`} title={label} />;
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
    <main className="section league-view sport-baseball">
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
