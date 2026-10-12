import Link from "next/link";

import {
  FADE_AMERICAN,
  FADE_STAKE,
  WINDOW_LABELS,
  betsHref,
  formatMoney,
  formatPct,
  formatSyncedAt,
  resultTone,
  safeHttpUrl,
  type BetWindow,
} from "@/lib/bets";
import {
  type PublicDocument,
  type PublicKpis,
  type PublicWarning,
  publicBreakdown,
  publicPrimeBucket,
  recentWarnings,
} from "@/lib/bets-public";

type Props = {
  document: PublicDocument;
  warnings: PublicWarning[];
  sports: string[];
  window: BetWindow;
  sport: string;
  who: string;
  kpi: PublicKpis;
};

function Chip({ result }: { result: string }) {
  const tone = resultTone(result);
  return <span className={`bets-chip bets-chip-${tone}`}>{result}</span>;
}

function Table({
  caption,
  rows,
}: {
  caption: string;
  rows: Array<PublicKpis & { key: string }>;
}) {
  if (!rows.length) {
    return (
      <section className="bets-breakdown">
        <h3>{caption}</h3>
        <p className="empty-note">No warnings in this slice.</p>
      </section>
    );
  }
  return (
    <section className="bets-breakdown">
      <h3>{caption}</h3>
      <div className="table-scroll">
        <table className="bets-table">
          <thead>
            <tr>
              <th>{caption}</th>
              <th>N</th>
              <th>Public</th>
              <th>BetMGM</th>
              <th>Fade P/L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td data-label={caption}>{row.key}</td>
                <td data-label="N">{row.warnings}</td>
                <td data-label="Public">{row.publicRecord}</td>
                <td data-label="BetMGM">{row.mgmRecord}</td>
                <td data-label="Fade P/L">{formatMoney(row.fadePl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PublicBoard({
  document,
  warnings,
  sports,
  window,
  sport,
  who,
  kpi,
}: Props) {
  const feed = recentWarnings(warnings, 40);
  return (
    <div className="bets-board">
      <div className="bets-filters" role="navigation" aria-label="Public warning filters">
        <div className="bets-filter-row">
          <span className="bets-filter-label">Window</span>
          {(["all", "cfb", "nfl"] as const).map((key) => (
            <Link
              key={key}
              href={betsHref({ tab: "warnings", window: key, sport, who })}
              className={window === key ? "is-active" : undefined}
            >
              {WINDOW_LABELS[key]}
            </Link>
          ))}
        </div>
        <div className="bets-filter-row">
          <span className="bets-filter-label">Sport</span>
          <Link
            href={betsHref({ tab: "warnings", window, sport: "", who })}
            className={!sport ? "is-active" : undefined}
          >
            All sports
          </Link>
          {sports.map((name) => (
            <Link
              key={name}
              href={betsHref({ tab: "warnings", window, sport: name, who })}
              className={sport === name ? "is-active" : undefined}
            >
              {name}
            </Link>
          ))}
        </div>
        <p className="bets-filter-note">
          John Ewing (@johnewing) flags lopsided BetMGM public money. Fade P/L
          assumes {FADE_AMERICAN} on ${FADE_STAKE} per graded warning.
        </p>
      </div>

      <div className="bets-kpi-grid">
        <article className="bets-card">
          <p className="bets-card-kicker">@johnewing</p>
          <h2>
            <a href="https://x.com/johnewing" rel="noopener noreferrer">
              Public side
            </a>
          </h2>
          <p className="bets-record">{kpi.publicRecord}</p>
          <dl className="bets-dl">
            <div>
              <dt>Win %</dt>
              <dd>{formatPct(kpi.publicWinPct)}</dd>
            </div>
            <div>
              <dt>Pending</dt>
              <dd>{kpi.publicPending}</dd>
            </div>
            <div>
              <dt>Warnings</dt>
              <dd>{kpi.warnings}</dd>
            </div>
          </dl>
        </article>
        <article className="bets-card">
          <p className="bets-card-kicker">House</p>
          <h2>BetMGM</h2>
          <p className="bets-record">{kpi.mgmRecord}</p>
          <dl className="bets-dl">
            <div>
              <dt>Win %</dt>
              <dd>{formatPct(kpi.mgmWinPct)}</dd>
            </div>
            <div>
              <dt>Pending</dt>
              <dd>{kpi.mgmPending}</dd>
            </div>
          </dl>
        </article>
        <article className="bets-card">
          <p className="bets-card-kicker">Assumed {FADE_AMERICAN}</p>
          <h2>Fade the public</h2>
          <p className="bets-record">{kpi.fadeRecord}</p>
          <dl className="bets-dl">
            <div>
              <dt>Win %</dt>
              <dd>{formatPct(kpi.fadeWinPct)}</dd>
            </div>
            <div>
              <dt>P/L $</dt>
              <dd>{formatMoney(kpi.fadePl)}</dd>
            </div>
            <div>
              <dt>ROI $</dt>
              <dd>{formatPct(kpi.fadeRoi)}</dd>
            </div>
            <div>
              <dt>Graded</dt>
              <dd>{kpi.fadeN}</dd>
            </div>
          </dl>
        </article>
      </div>

      <Table
        caption="By sport"
        rows={publicBreakdown(warnings, (row) => row.sport || "Other")}
      />
      <Table
        caption="Market"
        rows={publicBreakdown(warnings, (row) => row.market || "—")}
      />
      <Table caption="Prime time" rows={publicBreakdown(warnings, publicPrimeBucket)} />
      <Table
        caption="Day"
        rows={publicBreakdown(warnings, (row) => row.dow || "—")}
      />
      <Table
        caption="% bucket"
        rows={publicBreakdown(warnings, (row) => row.bucket || "—")}
      />

      <section className="bets-feed" aria-labelledby="public-feed-heading">
        <h2 id="public-feed-heading">Recent warnings</h2>
        <p className="bets-filter-note">
          Newest first. Showing {feed.length} of {warnings.length} in this filter.
        </p>
        <ol className="bets-feed-list">
          {feed.map((row) => {
            const href = safeHttpUrl(row.url);
            return (
            <li key={row.id} className="bets-feed-item">
              <div className="bets-feed-top">
                <Chip result={row.public_res} />
                <span className="bets-feed-who">Public</span>
                <span className="bets-feed-meta">
                  BetMGM {row.mgm_res} · {row.sport || "—"} · {row.market || "—"} ·{" "}
                  {row.posted || row.gd || "—"}
                </span>
              </div>
              <p className="bets-feed-legs">
                {row.matchup || "—"}
                {row.public_side ? ` · public ${row.public_side}` : ""}
              </p>
              <p className="bets-feed-meta">
                {row.bucket || "—"}
                {row.handle != null ? ` · handle ${row.handle}%` : ""}
                {row.score ? ` · ${row.score}` : ""}
                {href ? (
                  <>
                    {" · "}
                    <a href={href} rel="noopener noreferrer">
                      X post
                    </a>
                  </>
                ) : null}
              </p>
            </li>
            );
          })}
        </ol>
      </section>

      <aside className="bets-caveats" aria-label="Caveats">
        <h2>Caveats</h2>
        <ul>
          <li>
            Public vs BetMGM records use columns Q and R. Fade P/L inverts the
            public result and prices it at {FADE_AMERICAN} on ${FADE_STAKE} —
            not a live ticket.
          </li>
          <li>
            Pending warnings are excluded from the record and the fade P/L.
          </li>
          <li>
            Last synced: <strong>{formatSyncedAt(document.synced_at)}</strong>
            {document.source ? ` · ${document.source}` : ""}.
          </li>
        </ul>
      </aside>
    </div>
  );
}

export function PublicEmpty() {
  return (
    <p className="empty-note">
      No public-money warnings in this slice. The job writes{" "}
      <code>bets/public_warnings.json</code> from BetMGM Public Warnings.
    </p>
  );
}
