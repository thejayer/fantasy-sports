import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import type { LeagueSnapshot, WeekBoxScoreSnapshot } from "@/lib/data";
import {
  findBoxMatchup,
  formatBoxPoints,
  isStarterSlot,
  sortLineup,
  teamName,
} from "@/lib/box-score";
import type { BoxScorePlayer } from "@/lib/data";

function LineupTable({
  title,
  score,
  projected,
  players,
  leagueId,
  season,
}: {
  title: string;
  score: number | null;
  projected?: number | null;
  players: BoxScorePlayer[];
  leagueId: string;
  season: number;
}) {
  const ordered = sortLineup(players);
  return (
    <div className="panel table-scroll">
      <h3 style={{ margin: "0.75rem 1rem 0.25rem", fontSize: "1.05rem" }}>
        {title}{" "}
        <span className="league-meta">
          {formatBoxPoints(score)}
          {projected != null ? ` · proj ${formatBoxPoints(projected)}` : ""}
        </span>
      </h3>
      <table className="table-cards">
        <thead>
          <tr>
            <th>Slot</th>
            <th>Player</th>
            <th>Opp</th>
            <th className="numeric">Pts</th>
            <th className="numeric">Proj</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((player, index) => {
            const id = player.id != null ? String(player.id) : "";
            const bench = !isStarterSlot(player.slot);
            return (
              <tr
                key={`${id}-${player.slot}-${index}`}
                className={bench ? "is-bench" : undefined}
              >
                <td data-label="Slot">{player.slot ?? "—"}</td>
                <td data-label="Player">
                  {id ? (
                    <Link
                      href={`/leagues/${leagueId}/players/${id}?season=${season}`}
                    >
                      {player.name ?? id}
                    </Link>
                  ) : (
                    (player.name ?? "—")
                  )}
                  {player.position ? (
                    <div className="league-meta">{player.position}</div>
                  ) : null}
                </td>
                <td data-label="Opp">
                  {player.on_bye_week
                    ? "BYE"
                    : player.pro_opponent && player.pro_opponent !== "None"
                      ? player.pro_opponent
                      : "—"}
                </td>
                <td data-label="Pts" className="numeric">
                  {formatBoxPoints(player.points)}
                </td>
                <td data-label="Proj" className="numeric">
                  {formatBoxPoints(player.projected_points)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function BoxScorePanel({
  league,
  week,
  teamA,
  teamB,
  snapshot,
}: {
  league: LeagueSnapshot;
  week: number;
  teamA: number;
  teamB: number;
  snapshot: WeekBoxScoreSnapshot | null;
}) {
  const backHref = `/leagues/${league.league_id}?season=${league.season}&tab=matchups&view=week&week=${week}`;

  if (!snapshot?.matchups?.length) {
    return (
      <div style={{ marginTop: "0.75rem" }}>
        <p className="league-meta">
          <Link href={backHref}>← Week {week} matchups</Link>
        </p>
        <EmptyState title="No box score for this week">
          Football box scores sync into{" "}
          <code>
            weeks/{`{N}`}.json
          </code>{" "}
          via <code>sj sync</code> (ESPN seasons 2019+). Season standings and
          roster pages never load these files.
        </EmptyState>
      </div>
    );
  }

  const matchup = findBoxMatchup(snapshot, teamA, teamB);
  if (!matchup) {
    return (
      <div style={{ marginTop: "0.75rem" }}>
        <p className="league-meta">
          <Link href={backHref}>← Week {week} matchups</Link>
        </p>
        <EmptyState title="Matchup not in this week file">
          No box score for {teamName(league, teamA)} vs{" "}
          {teamName(league, teamB)} in week {week}.
        </EmptyState>
      </div>
    );
  }

  const leftId = matchup.home_team_id;
  const rightId = matchup.away_team_id;

  return (
    <div className="box-score-panel" style={{ marginTop: "0.75rem" }}>
      <p className="league-meta">
        <Link href={backHref}>← Week {week} matchups</Link>
      </p>
      <p className="lede">
        {`Week ${week} box score — fantasy points are this league's ESPN scoring (not raw yards/TDs).`}
        {matchup.is_playoff ? " Playoff matchup." : ""}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "1rem",
        }}
      >
        <LineupTable
          title={teamName(league, leftId)}
          score={matchup.home_score ?? null}
          projected={matchup.home_projected}
          players={matchup.home_lineup ?? []}
          leagueId={league.league_id}
          season={league.season}
        />
        <LineupTable
          title={teamName(league, rightId)}
          score={matchup.away_score ?? null}
          projected={matchup.away_projected}
          players={matchup.away_lineup ?? []}
          leagueId={league.league_id}
          season={league.season}
        />
      </div>
    </div>
  );
}
