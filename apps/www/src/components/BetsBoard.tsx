import Link from "next/link";

import { SignOutButton } from "@/components/SignOutButton";
import type { BetsActor } from "@/lib/session";
import {
  BETTOR_META,
  BETTORS,
  type BetRow,
  type BetsDocument,
  type BettorKpis,
  type BetWindow,
  type BreakdownRow,
  WINDOW_LABELS,
  breakdown,
  classifyParlay,
  formatMoney,
  formatPct,
  formatSyncedAt,
  formatUnits,
  gameWeekday,
  legsBucket,
  primeBucket,
  primeSlot,
  recentBets,
  resultTone,
  uniqueSports,
} from "@/lib/bets";

type Props = {
  document: BetsDocument;
  bets: BetRow[];
  window: BetWindow;
  sport: string;
  sports: string[];
  trent: BettorKpis;
  steve: BettorKpis;
  actor: BetsActor;
};

function hrefFor(window: BetWindow, sport: string): string {
  const params = new URLSearchParams();
  if (window !== "all") params.set("window", window);
  if (sport) params.set("sport", sport);
  const query = params.toString();
  return query ? `/bets?${query}` : "/bets";
}

function KpiCard({
  title,
  handle,
  href,
  kpi,
}: {
  title: string;
  handle?: string;
  href?: string;
  kpi: BettorKpis;
}) {
  return (
    <article className="bets-card">
      <p className="bets-card-kicker">{handle ? `@${handle}` : "Head to head"}</p>
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
          <dt>Win %</dt>
          <dd>{formatPct(kpi.winPct)}</dd>
        </div>
        <div>
          <dt>Net P/L $</dt>
          <dd>{formatMoney(kpi.pl)}</dd>
        </div>
        <div>
          <dt>ROI $</dt>
          <dd>{formatPct(kpi.roi)}</dd>
        </div>
        <div>
          <dt>Units P/L</dt>
          <dd>{formatUnits(kpi.unitsPl)}</dd>
        </div>
        <div>
          <dt>Units ROI</dt>
          <dd>{formatPct(kpi.unitsRoi)}</dd>
        </div>
        <div>
          <dt>Bets</dt>
          <dd>{kpi.bets}</dd>
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

function BreakdownTable({
  caption,
  rows,
}: {
  caption: string;
  rows: BreakdownRow[];
}) {
  if (!rows.length) {
    return (
      <section className="bets-breakdown">
        <h3>{caption}</h3>
        <p className="empty-note">No bets in this slice.</p>
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
              <th>Bets</th>
              <th>W-L-P</th>
              <th>Win %</th>
              <th>P/L $</th>
              <th>ROI $</th>
              <th>Units P/L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td data-label={caption}>{row.key}</td>
                <td data-label="Bets">{row.bets}</td>
                <td data-label="W-L-P">{row.record}</td>
                <td data-label="Win %">{formatPct(row.winPct)}</td>
                <td data-label="P/L $">{formatMoney(row.pl)}</td>
                <td data-label="ROI $">{formatPct(row.roi)}</td>
                <td data-label="Units P/L">{formatUnits(row.unitsPl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Chip({ result }: { result: string }) {
  const tone = resultTone(result);
  return <span className={`bets-chip bets-chip-${tone}`}>{result}</span>;
}

export function BetsBoard({
  document,
  bets,
  window,
  sport,
  sports,
  trent,
  steve,
  actor,
}: Props) {
  const feed = recentBets(bets, 50);
  const windows = (["all", "cfb", "nfl"] as const).map((key) => ({
    key,
    label: WINDOW_LABELS[key],
  }));

  return (
    <div className="bets-board">
      <p className="bets-toolbar">
        <span>
          Signed in as {actor.email}
          {actor.source === "bypass" ? " (dev bypass)" : ""}
        </span>
        {actor.source === "session" ? <SignOutButton /> : null}
      </p>

      <div className="bets-filters" role="navigation" aria-label="Bet filters">
        <div className="bets-filter-row">
          <span className="bets-filter-label">Window</span>
          {windows.map((item) => (
            <Link
              key={item.key}
              href={hrefFor(item.key, sport)}
              className={window === item.key ? "is-active" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div className="bets-filter-row">
          <span className="bets-filter-label">Sport</span>
          <Link
            href={hrefFor(window, "")}
            className={!sport ? "is-active" : undefined}
          >
            All sports
          </Link>
          {sports.map((name) => (
            <Link
              key={name}
              href={hrefFor(window, name)}
              className={sport === name ? "is-active" : undefined}
            >
              {name}
            </Link>
          ))}
        </div>
        <p className="bets-filter-note">
          Windows use <strong>game date</strong> when present, otherwise the{" "}
          <strong>X post date (CT)</strong>. CFB start is {WINDOW_LABELS.cfb}{" "}
          (2026-08-27); NFL start is {WINDOW_LABELS.nfl} (2026-09-09).
        </p>
      </div>

      <div className="bets-kpi-grid">
        {BETTORS.map((who) => {
          const meta = BETTOR_META[who];
          const kpi = who === "Trent" ? trent : steve;
          return (
            <KpiCard
              key={who}
              title={meta.name}
              handle={meta.handle}
              href={meta.href}
              kpi={kpi}
            />
          );
        })}
        <KpiCard
          title="Trent vs Steve"
          kpi={{
            ...trent,
            who: "H2H",
            bets: trent.bets + steve.bets,
            wins: trent.wins + steve.wins,
            losses: trent.losses + steve.losses,
            pushes: trent.pushes + steve.pushes,
            pending: trent.pending + steve.pending,
            unknown: trent.unknown + steve.unknown,
            record: `${trent.record} vs ${steve.record}`,
            winPct: null,
            stake: null,
            pl:
              trent.pl != null || steve.pl != null
                ? (trent.pl ?? 0) - (steve.pl ?? 0)
                : null,
            roi: null,
            unitsStaked: null,
            unitsPl:
              trent.unitsPl != null || steve.unitsPl != null
                ? (trent.unitsPl ?? 0) - (steve.unitsPl ?? 0)
                : null,
            unitsRoi: null,
          }}
        />
      </div>
      <p className="bets-h2h-note">
        Head-to-head P/L is Trent minus Steve (positive = Trent ahead). Records
        stay on each card. Combined slice: {trent.bets + steve.bets} bets.
      </p>

      {BETTORS.map((who) => {
        const rows = bets.filter((b) => b.who === who);
        return (
          <div key={who} className="bets-who-block">
            <h2 className="bets-who-heading">{BETTOR_META[who].name}</h2>
            <BreakdownTable
              caption="By sport"
              rows={breakdown(rows, (b) => b.sport || "Other")}
            />
            <BreakdownTable
              caption="Prime time"
              rows={breakdown(rows, primeBucket)}
            />
            <BreakdownTable
              caption="Prime-time slot"
              rows={breakdown(
                rows.filter((b) => primeBucket(b) === "Prime time"),
                primeSlot,
              )}
            />
            <BreakdownTable
              caption="Game day"
              rows={breakdown(rows, gameWeekday)}
            />
            <BreakdownTable
              caption="Bet type"
              rows={breakdown(rows, (b) => b.bt || "—")}
            />
            <BreakdownTable
              caption="Single vs multi"
              rows={breakdown(rows, (b) =>
                classifyParlay(b) === "multi" ? "Parlay / SGP / multi" : "Single",
              )}
            />
            <BreakdownTable
              caption="Number of legs"
              rows={breakdown(rows, legsBucket)}
            />
          </div>
        );
      })}

      <section className="bets-feed" aria-labelledby="bets-feed-heading">
        <h2 id="bets-feed-heading">Recent bets</h2>
        <p className="bets-filter-note">
          Newest first. Showing {feed.length} of {bets.length} in this filter.
        </p>
        <ol className="bets-feed-list">
          {feed.map((bet) => (
            <li key={bet.id} className="bets-feed-item">
              <div className="bets-feed-top">
                <Chip result={bet.res} />
                <span className="bets-feed-who">{bet.who}</span>
                <span className="bets-feed-meta">
                  {bet.sport || "—"} · {bet.bt || "—"} · {bet.posted || bet.gd || "—"}
                </span>
              </div>
              <p className="bets-feed-legs">{bet.legs || "—"}</p>
              <p className="bets-feed-meta">
                {bet.odds || "odds n/a"}
                {" · "}
                {bet.stake != null ? formatMoney(bet.stake, 2) : "no $ stake"}
                {bet.units != null ? ` · ${formatUnits(bet.units)}` : ""}
                {bet.book ? ` · ${bet.book}` : ""}
                {bet.url ? (
                  <>
                    {" · "}
                    <a href={bet.url} rel="noopener noreferrer">
                      X post
                    </a>
                  </>
                ) : null}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <aside className="bets-caveats" aria-label="Caveats">
        <h2>Caveats</h2>
        <ul>
          <li>
            Trent mostly posts units without odds, so his dollar P/L covers only
            slips with a visible stake.
          </li>
          <li>
            Steve&apos;s totals include bets he placed for friends on his own
            Gamdom account.
          </li>
          <li>
            Pending and Unknown bets are excluded from the record and P/L.
          </li>
          <li>
            Last synced: <strong>{formatSyncedAt(document.synced_at)}</strong>
            {document.source ? ` · ${document.source}` : ""}. Computed from the
            Bets tab only — sheet formula tabs are ignored.
          </li>
        </ul>
      </aside>
    </div>
  );
}

export function BetsEmpty() {
  return (
    <p className="empty-note">
      No bet rows in this slice. If this is production, the{" "}
      <code>sj bets</code> job has not written <code>bets/bets.json</code> yet.
    </p>
  );
}

export function availableSports(allBets: BetRow[]): string[] {
  return uniqueSports(allBets);
}
