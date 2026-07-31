import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { SeasonSwitcher } from "@/components/SeasonSwitcher";
import type { LeagueSnapshot, Player, Team } from "@/lib/data";
import { parseGolfSettings, DEFAULT_GOLF_SETTINGS } from "@/lib/golf";
import { recordLabel, winPctLabel } from "@/lib/league";

function slotRank(slot: string | null | undefined): number {
  if (slot === "GS") return 0;
  if (slot === "BE") return 1;
  return 2;
}

function playerName(
  roster: Player[],
  playerId: number | null | undefined,
): string {
  if (playerId == null) return "—";
  return roster.find((p) => p.id === playerId)?.name ?? `#${playerId}`;
}

function RosterSection({
  title,
  players,
  leagueId,
  season,
}: {
  title: string;
  players: Player[];
  leagueId: string;
  season: number;
}) {
  if (!players.length) return null;
  return (
    <div className="panel table-scroll" style={{ marginTop: "0.75rem" }}>
      <h3 style={{ margin: "0.75rem 1rem 0" }}>{title}</h3>
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
          {players.map((player) => (
            <tr key={`${player.id}-${player.slot}`}>
              <td data-label="Slot">{player.slot ?? "—"}</td>
              <td data-label="Player">
                {player.id != null ? (
                  <Link
                    href={`/leagues/${leagueId}/players/${player.id}?season=${season}`}
                  >
                    {player.name ?? "—"}
                  </Link>
                ) : (
                  (player.name ?? "—")
                )}
              </td>
              <td data-label="OWGR">
                {player.season_stats?.OWGR != null
                  ? String(player.season_stats.OWGR)
                  : "—"}
              </td>
              <td data-label="Country">{player.pro_team ?? "—"}</td>
              <td data-label="Acquired">{player.acquisition_type ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
  const bench = roster.filter((p) => p.slot === "BE");
  const other = roster.filter((p) => p.slot !== "GS" && p.slot !== "BE");

  const eventId =
    league.lineups?.current_event_id ??
    league.lineups?.events?.[0]?.event_id ??
    null;
  const eventMeta = league.lineups?.events?.find((e) => e.event_id === eventId);
  const weekLineup =
    eventId != null
      ? league.lineups?.teams?.[String(team.team_id)]?.[eventId]
      : undefined;

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
        {winPctLabel(team)}) · {starters.length}/{golf.roster.starters} season
        starters (GS) · {bench.length} bench (BE). Weekly Alt1/Alt2 live on the
        Lineup tab.
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
          Run a snake draft from Create golf league /{" "}
          <code>sg create-league</code> to fill 5 starters + bench from the OWGR
          pool.
        </EmptyState>
      ) : (
        <>
          {weekLineup && eventMeta ? (
            <div className="panel" style={{ padding: "1rem", marginTop: "0.75rem" }}>
              <h3 style={{ marginTop: 0 }}>
                Current event lineup · {eventMeta.name}
              </h3>
              <p className="league-meta" style={{ marginTop: 0 }}>
                Captain {playerName(roster, weekLineup.captain)} · Alt1{" "}
                {playerName(roster, weekLineup.alt1)} · Alt2{" "}
                {playerName(roster, weekLineup.alt2)} ·{" "}
                <Link
                  href={`/leagues/${league.league_id}?season=${league.season}&tab=lineup&event=${eventId}&team=${team.team_id}`}
                >
                  Edit lineup
                </Link>
              </p>
            </div>
          ) : null}
          <RosterSection
            title="Starters (GS)"
            players={starters}
            leagueId={league.league_id}
            season={league.season}
          />
          <RosterSection
            title="Bench (BE)"
            players={bench}
            leagueId={league.league_id}
            season={league.season}
          />
          <RosterSection
            title="Other"
            players={other}
            leagueId={league.league_id}
            season={league.season}
          />
        </>
      )}
    </main>
  );
}
