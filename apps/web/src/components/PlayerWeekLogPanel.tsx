import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import {
  boxPairKey,
  formatBoxPoints,
  teamName,
  type PlayerWeekGameLog,
} from "@/lib/box-score";
import type { LeagueSnapshot } from "@/lib/data";

/**
 * Football player multi-week fantasy log from ``weeks/{N}.json`` (roadmap 8.1).
 * Distinct from franchise ``GameLogPanel`` (team schedule W/L).
 */
export function PlayerWeekLogPanel({
  league,
  log,
}: {
  league: LeagueSnapshot;
  log: PlayerWeekGameLog;
}) {
  const periodLabel = league.period_label || "week";

  if (!log.rows.length) {
    return (
      <section className="player-section">
        <h3 className="roster-group-title">Game log</h3>
        <EmptyState title="No week box scores for this player">
          Football game logs come from synced{" "}
          <code>weeks/{`{N}`}.json</code> files (ESPN seasons 2019+). Season
          standings never load those files.
        </EmptyState>
      </section>
    );
  }

  return (
    <section className="player-section">
      <h3 className="roster-group-title">Game log</h3>
      <p className="league-meta" style={{ marginTop: 0 }}>
        {log.rows.length} {periodLabel}
        {log.rows.length === 1 ? "" : "s"}
        {log.totalPoints != null
          ? ` · ${formatBoxPoints(log.totalPoints)} total`
          : ""}
        {log.avgPoints != null
          ? ` · ${formatBoxPoints(log.avgPoints)} avg`
          : ""}{" "}
        — league ESPN points (not raw yards/TDs).
      </p>
      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th>{periodLabel}</th>
              <th>Slot</th>
              <th>Fantasy team</th>
              <th>vs</th>
              <th>Opp</th>
              <th className="numeric">Pts</th>
              <th className="numeric">Proj</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {log.rows.map((row) => {
              const boxHref =
                row.teamId != null && row.opponentTeamId != null
                  ? `/leagues/${league.league_id}?season=${league.season}&tab=matchups&view=week&week=${row.week}&box=${boxPairKey(row.teamId, row.opponentTeamId)}`
                  : null;
              return (
                <tr key={`${row.week}-${row.teamId ?? "x"}-${row.slot ?? ""}`}>
                  <td data-label={periodLabel}>{row.week}</td>
                  <td data-label="Slot">{row.slot ?? "—"}</td>
                  <td data-label="Fantasy team">
                    {row.teamId != null ? (
                      <Link
                        href={`/leagues/${league.league_id}/teams/${row.teamId}?season=${league.season}`}
                      >
                        {teamName(league, row.teamId)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label="vs">
                    {row.opponentTeamId != null ? (
                      <Link
                        href={`/leagues/${league.league_id}/teams/${row.opponentTeamId}?season=${league.season}`}
                      >
                        {teamName(league, row.opponentTeamId)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label="Opp">
                    {row.onByeWeek ? (
                      <span className="muted">Bye</span>
                    ) : (
                      (row.proOpponent ?? "—")
                    )}
                  </td>
                  <td data-label="Pts" className="numeric">
                    {formatBoxPoints(row.points)}
                  </td>
                  <td data-label="Proj" className="numeric">
                    {formatBoxPoints(row.projectedPoints)}
                  </td>
                  <td data-label="Box">
                    {boxHref ? (
                      <Link href={boxHref} className="league-meta">
                        Box
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
