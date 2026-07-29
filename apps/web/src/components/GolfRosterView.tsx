import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { SeasonSwitcher } from "@/components/SeasonSwitcher";
import type { LeagueSnapshot, Team } from "@/lib/data";
import { parseGolfSettings, DEFAULT_GOLF_SETTINGS } from "@/lib/golf";
import { recordLabel, winPctLabel } from "@/lib/league";

function slotRank(slot: string | null | undefined): number {
  if (slot === "GS") return 0;
  if (slot === "ALT") return 1;
  if (slot === "BE") return 2;
  return 3;
}

export function GolfRosterView({
  league,
  team,
  seasons,
}: {
  league: LeagueSnapshot;
  team: Team;
  seasons: number[];
}) {
  const golf = parseGolfSettings(league.settings) ?? DEFAULT_GOLF_SETTINGS;
  const roster = [...team.roster].sort(
    (a, b) =>
      slotRank(a.slot) - slotRank(b.slot) ||
      (a.season_stats?.OWGR ?? 9999) - (b.season_stats?.OWGR ?? 9999) ||
      (a.name ?? "").localeCompare(b.name ?? ""),
  );
  const starters = roster.filter((p) => p.slot === "GS");
  const bench = roster.filter((p) => p.slot !== "GS");

  return (
    <main className={`section league-view sport-${league.sport}`}>
      <div className="league-kicker">
        <Link
          className="league-meta"
          href={`/leagues/${league.league_id}?season=${league.season}`}
        >
          {league.name}
        </Link>
        <span className="league-meta">season {league.season}</span>
      </div>
      <h2>{team.name}</h2>
      <p className="lede">
        {team.owners.join(", ") || "Owner TBD"} · {recordLabel(team)} (
        {winPctLabel(team)}) · {starters.length}/{golf.roster.starters} starters
        · {bench.length} bench · weekly lineup locks in 6.4c
      </p>

      <SeasonSwitcher
        seasons={seasons}
        current={league.season}
        hrefFor={(year) =>
          `/leagues/${league.league_id}/teams/${team.team_id}?season=${year}`
        }
      />

      {!roster.length ? (
        <EmptyState title="No drafted golfers yet">
          Run a snake draft from Create golf league / <code>sg create-league</code>{" "}
          to fill 5 starters + bench from the OWGR pool.
        </EmptyState>
      ) : (
        <div className="panel table-scroll">
          <table className="table-cards">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Player</th>
                <th>OWGR</th>
                <th>Country</th>
                <th>Acquired</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((player) => (
                <tr key={`${player.id}-${player.slot}`}>
                  <td data-label="Slot">{player.slot ?? "—"}</td>
                  <td data-label="Player">{player.name ?? "—"}</td>
                  <td data-label="OWGR">
                    {player.season_stats?.OWGR != null
                      ? String(player.season_stats.OWGR)
                      : "—"}
                  </td>
                  <td data-label="Country">{player.pro_team ?? "—"}</td>
                  <td data-label="Acquired">
                    {player.acquisition_type ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
