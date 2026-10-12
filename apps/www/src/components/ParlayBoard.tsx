import Link from "next/link";

import {
  WINDOW_LABELS,
  betsHref,
  bettorMeta,
  formatPct,
  formatSyncedAt,
  resultTone,
  safeHttpUrl,
  type BetWindow,
} from "@/lib/bets";
import {
  type ParlayDocument,
  type ParlayKpis,
  type ParlayLeg,
  parlayBreakdown,
  parlayPrimeBucket,
  recentLegs,
} from "@/lib/bets-parlay";

type Props = {
  document: ParlayDocument;
  legs: ParlayLeg[];
  names: string[];
  sports: string[];
  window: BetWindow;
  sport: string;
  who: string;
  kpis: ParlayKpis[];
  combined: ParlayKpis;
};

function Chip({ result }: { result: string }) {
  const tone = resultTone(result);
  return <span className={`bets-chip bets-chip-${tone}`}>{result}</span>;
}

function KpiCard({ title, handle, href, kpi }: {
  title: string;
  handle?: string;
  href?: string;
  kpi: ParlayKpis;
}) {
  return (
    <article className="bets-card">
      <p className="bets-card-kicker">{handle ? `@${handle}` : "Combined"}</p>
      <h2>
        {href ? (
          <a href={href} rel="noopener noreferrer">
            {title}
          </a>
        ) : (
          title
        )}
      </h2>
      <p className="bets-record">{kpi.record}</p>
      <dl className="bets-dl">
        <div>
          <dt>Leg hit %</dt>
          <dd>{formatPct(kpi.hitRate)}</dd>
        </div>
        <div>
          <dt>Fade</dt>
          <dd>{kpi.fadeRecord}</dd>
        </div>
        <div>
          <dt>Fade hit %</dt>
          <dd>{formatPct(kpi.fadeHitRate)}</dd>
        </div>
        <div>
          <dt>Legs</dt>
          <dd>{kpi.legs}</dd>
        </div>
        <div>
          <dt>Pending</dt>
          <dd>{kpi.pending}</dd>
        </div>
        <div>
          <dt>Unknown</dt>
          <dd>{kpi.unknown}</dd>
        </div>
      </dl>
    </article>
  );
}

function Table({
  caption,
  rows,
}: {
  caption: string;
  rows: Array<ParlayKpis & { key: string }>;
}) {
  if (!rows.length) {
    return (
      <section className="bets-breakdown">
        <h3>{caption}</h3>
        <p className="empty-note">No legs in this slice.</p>
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
              <th>Legs</th>
              <th>Hit</th>
              <th>Hit %</th>
              <th>Fade</th>
              <th>Fade %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td data-label={caption}>{row.key}</td>
                <td data-label="Legs">{row.legs}</td>
                <td data-label="Hit">{row.record}</td>
                <td data-label="Hit %">{formatPct(row.hitRate)}</td>
                <td data-label="Fade">{row.fadeRecord}</td>
                <td data-label="Fade %">{formatPct(row.fadeHitRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ParlayBoard({
  document,
  legs,
  names,
  sports,
  window,
  sport,
  who,
  kpis,
  combined,
}: Props) {
  const feed = recentLegs(legs, 40);
  const focus = who || "all";
  return (
    <div className="bets-board">
      <div className="bets-filters" role="navigation" aria-label="Parlay filters">
        <div className="bets-filter-row">
          <span className="bets-filter-label">Bettor</span>
          <Link
            href={betsHref({ tab: "parlays", window, sport, who: "" })}
            className={!who ? "is-active" : undefined}
          >
            All
          </Link>
          {names.map((name) => (
            <Link
              key={name}
              href={betsHref({ tab: "parlays", window, sport, who: name })}
              className={who === name ? "is-active" : undefined}
            >
              {bettorMeta(name).name}
            </Link>
          ))}
        </div>
        <div className="bets-filter-row">
          <span className="bets-filter-label">Window</span>
          {(["all", "cfb", "nfl"] as const).map((key) => (
            <Link
              key={key}
              href={betsHref({ tab: "parlays", window: key, sport, who })}
              className={window === key ? "is-active" : undefined}
            >
              {WINDOW_LABELS[key]}
            </Link>
          ))}
        </div>
        <div className="bets-filter-row">
          <span className="bets-filter-label">Sport</span>
          <Link
            href={betsHref({ tab: "parlays", window, sport: "", who })}
            className={!sport ? "is-active" : undefined}
          >
            All sports
          </Link>
          {sports.map((name) => (
            <Link
              key={name}
              href={betsHref({ tab: "parlays", window, sport: name, who })}
              className={sport === name ? "is-active" : undefined}
            >
              {name}
            </Link>
          ))}
        </div>
        <p className="bets-filter-note">
          Each parlay is split into legs. Hit rate is the leg result; fade is
          the opposite side already stored on the sheet. <code>Value</code>{" "}
          cells are treated as blank.
        </p>
      </div>

      <div className="bets-kpi-grid">
        <KpiCard title="All bettors" kpi={combined} />
        {kpis.map((kpi) => {
          const meta = bettorMeta(kpi.who || "");
          return (
            <KpiCard
              key={kpi.who || meta.name}
              title={meta.name}
              handle={meta.handle}
              href={meta.href}
              kpi={kpi}
            />
          );
        })}
      </div>

      <div className="bets-who-block">
        <h2 className="bets-who-heading">
          {focus === "all" ? "All bettors" : bettorMeta(focus).name}
        </h2>
        <Table
          caption="Props vs team picks"
          rows={parlayBreakdown(legs, (leg) => leg.pick || "—")}
        />
        <Table
          caption="Over / under"
          rows={parlayBreakdown(legs, (leg) => leg.ou || "—")}
        />
        <Table
          caption="Stat category"
          rows={parlayBreakdown(legs, (leg) => leg.stat || "—")}
        />
        <Table
          caption="Sport"
          rows={parlayBreakdown(legs, (leg) => leg.sport || "Other")}
        />
        <Table caption="Prime time" rows={parlayBreakdown(legs, parlayPrimeBucket)} />
      </div>

      <section className="bets-feed" aria-labelledby="parlay-feed-heading">
        <h2 id="parlay-feed-heading">Recent legs</h2>
        <p className="bets-filter-note">
          Newest first. Showing {feed.length} of {legs.length} in this filter.
        </p>
        <ol className="bets-feed-list">
          {feed.map((leg) => {
            const href = safeHttpUrl(leg.url);
            return (
            <li key={leg.id} className="bets-feed-item">
              <div className="bets-feed-top">
                <Chip result={leg.res} />
                <span className="bets-feed-who">{leg.who}</span>
                <span className="bets-feed-meta">
                  fade {leg.fade} · {leg.sport || "—"} · {leg.pick || "—"} ·{" "}
                  {leg.posted || leg.gd || "—"}
                </span>
              </div>
              <p className="bets-feed-legs">{leg.sel || "—"}</p>
              <p className="bets-feed-meta">
                {leg.stat || "—"}
                {leg.line ? ` · ${leg.line}` : ""}
                {leg.dir ? ` · ${leg.dir}` : ""}
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
            Legs come from the Parlay Legs tab, not the Bets-tab slip result.
          </li>
          <li>
            Fade record uses the sheet&apos;s fade result (falls back to
            inverting W/L when fade is blank).
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

export function ParlayEmpty() {
  return (
    <p className="empty-note">
      No parlay legs in this slice. The job writes{" "}
      <code>bets/parlay_legs.json</code> from the Parlay Legs tab.
    </p>
  );
}
