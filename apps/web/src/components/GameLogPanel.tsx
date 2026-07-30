import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import type { LeagueSnapshot, Team } from "@/lib/data";
import { buildGameLog, sparklineHeights } from "@/lib/game-log";
import { formatMatchupScore, outcomeTone } from "@/lib/matchups";

/** Season results for one franchise (roadmap 7.4). */
export function GameLogPanel({
  league,
  team,
}: {
  league: LeagueSnapshot;
  team: Team;
}) {
  const periodLabel =
    league.period_label || (league.sport === "baseball" ? "period" : "week");
  const log = buildGameLog(team, league.teams);
  const bars = sparklineHeights(log.rows);

  if (!log.rows.length) {
    return (
      <EmptyState title={`No ${periodLabel} results in this snapshot`}>
        Schedule and scores appear once this season has synced matchups.
      </EmptyState>
    );
  }

  const teamHref = (id: number | null) =>
    id == null
      ? null
      : `/leagues/${league.league_id}/teams/${id}?season=${league.season}`;

  return (
    <section className="game-log">
      <div className="game-log-head">
        <h3 className="roster-group-title">Season results</h3>
        <p className="league-meta" style={{ margin: 0 }}>
          {log.played.length} played
          {log.averageScore != null
            ? ` · ${log.averageScore.toFixed(1)} avg`
            : ""}
          {log.high ? ` · high ${formatMatchupScore(log.high.score)} (${periodLabel} ${log.high.period})` : ""}
          {log.low ? ` · low ${formatMatchupScore(log.low.score)} (${periodLabel} ${log.low.period})` : ""}
        </p>
      </div>

      {bars.length ? (
        <div
          className="sparkline"
          role="img"
          aria-label={`Weekly scores: ${bars
            .map((bar) => `${periodLabel} ${bar.period} ${formatMatchupScore(bar.row.score)}`)
            .join(", ")}`}
        >
          {bars.map((bar) => (
            <span
              key={bar.period}
              className={`sparkline-bar tone-${outcomeTone(bar.row.outcome)}`}
              style={{ height: `${(bar.height * 100).toFixed(1)}%` }}
              title={`${periodLabel} ${bar.period}: ${formatMatchupScore(bar.row.score)}`}
            />
          ))}
        </div>
      ) : null}

      {log.next ? (
        <p className="league-meta game-log-next">
          Next: {periodLabel} {log.next.period} vs{" "}
          {teamHref(log.next.opponentId) ? (
            <Link href={teamHref(log.next.opponentId)!}>
              {log.next.opponentName}
            </Link>
          ) : (
            (log.next.opponentName ?? "TBD")
          )}
        </p>
      ) : null}

      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th>{periodLabel}</th>
              <th>Opponent</th>
              <th className="numeric">Score</th>
              <th className="numeric">Opp</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {log.rows.map((row) => {
              const href = teamHref(row.opponentId);
              const tone = outcomeTone(row.outcome);
              return (
                <tr key={row.period} className={row.upcoming ? "is-upcoming" : undefined}>
                  <td data-label={periodLabel}>{row.period}</td>
                  <td data-label="Opponent">
                    {row.bye ? (
                      <span className="muted">Bye</span>
                    ) : href ? (
                      <Link href={href}>{row.opponentName}</Link>
                    ) : (
                      (row.opponentName ?? "—")
                    )}
                  </td>
                  <td data-label="Score" className="numeric">
                    {formatMatchupScore(row.score)}
                  </td>
                  <td data-label="Opp" className="numeric">
                    {formatMatchupScore(row.opponentScore)}
                  </td>
                  <td data-label="Result">
                    {row.bye ? (
                      "—"
                    ) : tone === "open" ? (
                      <span className="muted">Upcoming</span>
                    ) : (
                      <span className={`outcome-pill outcome-${tone}`}>
                        {row.outcome}
                      </span>
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
