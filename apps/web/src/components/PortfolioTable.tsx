import Link from "next/link";

import { buildPortfolioRows } from "@/lib/portfolio";
import type { HomeLeagueCard } from "@/lib/member-home";
import { sportFormatLabel } from "@/lib/league";

/** Dense cross-league portfolio strip (roadmap 9.4) over member home cards. */
export function PortfolioTable({ cards }: { cards: HomeLeagueCard[] }) {
  const rows = buildPortfolioRows(cards);
  if (!rows.length) return null;

  const showMake = rows.some((row) => row.makePlayoffs != null);

  return (
    <section className="panel portfolio-panel" aria-labelledby="portfolio-heading">
      <h3 id="portfolio-heading" className="roster-group-title">
        Your portfolio
      </h3>
      <p className="league-meta portfolio-lede">
        Record and standing across every league — open a row for the full card
        below.
      </p>
      <div className="panel table-scroll portfolio-table-wrap">
        <table className="table-cards portfolio-table">
          <thead>
            <tr>
              <th>Sport</th>
              <th>League</th>
              <th>Team</th>
              <th>Record</th>
              <th>Standing</th>
              <th>This period</th>
              <th>Next</th>
              {showMake ? <th className="numeric">Make%</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.leagueId}
                className={row.linked ? "is-viewer" : undefined}
              >
                <td data-label="Sport">
                  <span className="pill sport-pill">
                    {sportFormatLabel(row.sport, row.format)}
                  </span>
                </td>
                <td data-label="League">
                  <Link href={row.leagueHref}>{row.leagueName}</Link>
                  <div className="league-meta">{row.season}</div>
                </td>
                <td data-label="Team">
                  {row.teamHref && row.teamName ? (
                    <Link href={row.teamHref}>{row.teamName}</Link>
                  ) : (
                    <Link href="/admin" className="muted">
                      Link in admin
                    </Link>
                  )}
                </td>
                <td data-label="Record">{row.record ?? "—"}</td>
                <td data-label="Standing">{row.standing ?? "—"}</td>
                <td data-label="This period">{row.matchup}</td>
                <td data-label="Next">{row.next ?? "—"}</td>
                {showMake ? (
                  <td data-label="Make%" className="numeric">
                    {row.makePlayoffs ?? "—"}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
