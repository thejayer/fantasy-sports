import Link from "next/link";
import { DroppedPlayersPanel } from "@/components/DroppedPlayersPanel";
import { EmptyState } from "@/components/EmptyState";
import { GameLogPanel } from "@/components/GameLogPanel";
import { KeeperBadge } from "@/components/KeeperBadge";
import { SeasonSwitcher } from "@/components/SeasonSwitcher";
import { ViewerBadge } from "@/components/ViewerBadge";
import type { LeagueSnapshot, Player } from "@/lib/data";
import {
  formatStat,
  isPitcher,
  recordLabel,
  sortRoster,
  stat,
  winPctLabel,
} from "@/lib/baseball";
import {
  isKeeperPlayer,
  keeperPlayerIds,
} from "@/lib/draft-results";
import { injuryTone } from "@/lib/league";

function StatusDot({ player }: { player: Player }) {
  const tone = injuryTone(player);
  const label = player.injury_status || player.status || "OK";
  return <span className={`status-dot ${tone}`} title={label} />;
}

export function BaseballRosterView({
  league,
  team,
  seasons,
  isViewerTeam = false,
}: {
  league: LeagueSnapshot;
  team: LeagueSnapshot["teams"][number];
  seasons: number[];
  /** Signed-in member's own franchise (roadmap 7.1). */
  isViewerTeam?: boolean;
}) {
  const roster = sortRoster(team.roster);
  const batters = roster.filter((player) => !isPitcher(player));
  const pitchers = roster.filter((player) => isPitcher(player));
  const keepers = keeperPlayerIds(league.draft, team.team_id);

  return (
    <main className="section league-view sport-baseball">
      <div className="league-kicker">
        <Link className="league-meta" href={`/leagues/${league.league_id}?season=${league.season}`}>
          {league.name}
        </Link>
        <span className="league-meta">season {league.season}</span>
      </div>
      <h2>
        {team.name}
        {isViewerTeam ? <ViewerBadge label="Your team" /> : null}
      </h2>
      <p className="lede">
        {team.owners.join(", ") || "Owner TBD"} · {recordLabel(team)} (
        {winPctLabel(team)}) · {team.roster.length} rostered
      </p>

      <SeasonSwitcher
        seasons={seasons}
        current={league.season}
        hrefFor={(year) =>
          `/leagues/${league.league_id}/teams/${team.team_id}?season=${year}`
        }
      />

      <GameLogPanel league={league} team={team} />

      <DroppedPlayersPanel league={league} team={team} />

      {!team.roster.length ? (
        <EmptyState title="No roster players in this snapshot">
          Rosters appear after sync when ESPN returns lineup data for this
          season.
        </EmptyState>
      ) : (
        <>
          <RosterGroup
            title="Batters"
            players={batters}
            kind="batter"
            keepers={keepers}
          />
          <RosterGroup
            title="Pitchers"
            players={pitchers}
            kind="pitcher"
            keepers={keepers}
          />
        </>
      )}
    </main>
  );
}

function RosterGroup({
  title,
  players,
  kind,
  keepers,
}: {
  title: string;
  players: Player[];
  kind: "batter" | "pitcher";
  keepers: Set<string>;
}) {
  if (!players.length) {
    return (
      <div style={{ marginTop: "1.5rem" }}>
        <h3 className="roster-group-title">{title}</h3>
        <EmptyState title={`No ${title.toLowerCase()} on this roster`} />
      </div>
    );
  }
  const batterStats = ["R", "HR", "RBI", "SB", "AVG", "OPS"] as const;
  const pitcherStats = ["IP", "W", "SV", "K", "ERA", "WHIP"] as const;
  return (
    <div style={{ marginTop: "1.5rem" }}>
      <h3 className="roster-group-title">{title}</h3>
      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th></th>
              <th>Slot</th>
              <th>Player</th>
              <th>Pos</th>
              <th>Pro</th>
              {kind === "batter"
                ? batterStats.map((label) => <th key={label}>{label}</th>)
                : pitcherStats.map((label) => <th key={label}>{label}</th>)}
              <th>FPts</th>
            </tr>
          </thead>
          <tbody>
            {players.map((player) => (
              <tr key={`${player.id}-${player.name}`}>
                <td data-label="Status">
                  <StatusDot player={player} />
                </td>
                <td data-label="Slot">{player.slot ?? "—"}</td>
                <td data-label="Player">
                  {player.name}
                  {isKeeperPlayer(player.id, keepers) ? <KeeperBadge /> : null}
                </td>
                <td data-label="Pos">{player.position ?? "—"}</td>
                <td data-label="Pro">{player.pro_team ?? "—"}</td>
                {kind === "batter" ? (
                  <>
                    <td data-label="R">{formatStat(stat(player, "R"))}</td>
                    <td data-label="HR">{formatStat(stat(player, "HR"))}</td>
                    <td data-label="RBI">{formatStat(stat(player, "RBI"))}</td>
                    <td data-label="SB">{formatStat(stat(player, "SB"))}</td>
                    <td data-label="AVG">{formatStat(stat(player, "AVG"), 3)}</td>
                    <td data-label="OPS">{formatStat(stat(player, "OPS"), 3)}</td>
                  </>
                ) : (
                  <>
                    <td data-label="IP">{formatStat(stat(player, "IP"), 1)}</td>
                    <td data-label="W">{formatStat(stat(player, "W"))}</td>
                    <td data-label="SV">{formatStat(stat(player, "SV"))}</td>
                    <td data-label="K">{formatStat(stat(player, "K"))}</td>
                    <td data-label="ERA">{formatStat(stat(player, "ERA"), 2)}</td>
                    <td data-label="WHIP">{formatStat(stat(player, "WHIP"), 2)}</td>
                  </>
                )}
                <td data-label="FPts">{player.total_points?.toFixed?.(1) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
