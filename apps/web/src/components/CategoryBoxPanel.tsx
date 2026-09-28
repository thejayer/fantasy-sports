import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import { formatStat } from "@/lib/baseball";
import {
  categoryBoxRows,
  categoryResultTone,
  findBoxMatchup,
  formatCatRecord,
  hasCategoryStats,
  teamName,
} from "@/lib/box-score";
import type { LeagueSnapshot, WeekBoxScoreSnapshot } from "@/lib/data";

function ResultPill({ result }: { result: string | null }) {
  const tone = categoryResultTone(result);
  if (tone === "open") return null;
  return <span className={`outcome-pill outcome-${tone}`}>{result}</span>;
}

function formatCatValue(id: string, value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  const upper = id.toUpperCase();
  if (upper === "AVG" || upper === "OBP" || upper === "OPS") {
    return formatStat(value, 3);
  }
  if (upper === "ERA" || upper === "WHIP") {
    return formatStat(value, 2);
  }
  if (Number.isInteger(value)) return formatStat(value, 0);
  return formatStat(value, 1);
}

export function CategoryBoxPanel({
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
  const periodLabel = league.period_label || "period";
  const backHref = `/leagues/${league.league_id}?season=${league.season}&tab=matchups&view=week&week=${week}`;

  if (!snapshot?.matchups?.length) {
    return (
      <div style={{ marginTop: "0.75rem" }}>
        <p className="league-meta">
          <Link href={backHref}>
            ← {periodLabel} {week} matchups
          </Link>
        </p>
        <EmptyState title="No category box for this period">
          Baseball period boxes sync into{" "}
          <code>
            weeks/{`{N}`}.json
          </code>{" "}
          via <code>sj sync</code> (ESPN H2H category leagues). Season Category
          Board under Tools stays season-to-date roster math.
        </EmptyState>
      </div>
    );
  }

  const matchup = findBoxMatchup(snapshot, teamA, teamB);
  if (!matchup || !hasCategoryStats(matchup)) {
    return (
      <div style={{ marginTop: "0.75rem" }}>
        <p className="league-meta">
          <Link href={backHref}>
            ← {periodLabel} {week} matchups
          </Link>
        </p>
        <EmptyState title="Matchup not in this period file">
          No category matrix for {teamName(league, teamA)} vs{" "}
          {teamName(league, teamB)} in {periodLabel} {week}.
        </EmptyState>
      </div>
    );
  }

  const homeId = matchup.home_team_id;
  const awayId = matchup.away_team_id;
  const rows = categoryBoxRows(league, matchup);

  return (
    <div className="category-box-panel" style={{ marginTop: "0.75rem" }}>
      <p className="league-meta">
        <Link href={backHref}>
          ← {periodLabel} {week} matchups
        </Link>
      </p>
      <p className="lede">
        {`Period ${week} category box — ESPN H2H cats for this scoring period (not the season-to-date Tools board).`}
      </p>
      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th>
                <Link
                  href={`/leagues/${league.league_id}/teams/${homeId}?season=${league.season}`}
                >
                  {teamName(league, homeId)}
                </Link>
                <div className="league-meta">
                  {formatCatRecord(
                    matchup.home_wins,
                    matchup.home_losses,
                    matchup.home_ties,
                  )}
                </div>
              </th>
              <th>Category</th>
              <th>
                <Link
                  href={`/leagues/${league.league_id}/teams/${awayId}?season=${league.season}`}
                >
                  {teamName(league, awayId)}
                </Link>
                <div className="league-meta">
                  {formatCatRecord(
                    matchup.away_wins,
                    matchup.away_losses,
                    matchup.away_ties,
                  )}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td data-label={teamName(league, homeId)}>
                  <span className="numeric" style={{ marginRight: "0.4rem" }}>
                    {formatCatValue(row.id, row.homeValue)}
                  </span>
                  <ResultPill result={row.homeResult} />
                </td>
                <td data-label="Category">{row.label}</td>
                <td data-label={teamName(league, awayId)}>
                  <span className="numeric" style={{ marginRight: "0.4rem" }}>
                    {formatCatValue(row.id, row.awayValue)}
                  </span>
                  <ResultPill result={row.awayResult} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
