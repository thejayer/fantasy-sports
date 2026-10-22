import Link from "next/link";

import { SignOutButton } from "@/components/SignOutButton";
import {
  BET_TABS,
  TAB_LABELS,
  type BetRow,
  type BetsDocument,
  type BettorKpis,
  type BetTab,
  type BetWindow,
  type BreakdownRow,
  WINDOW_LABELS,
  betsHref,
  bettorMeta,
  breakdown,
  classifyParlay,
  formatMoney,
  formatPct,
  formatSyncedAt,
  formatUnits,
  gameWeekday,
  isHypothetical1u,
  legsBucket,
  primeBucket,
  primeSlot,
  recentBets,
  resultTone,
  safeHttpUrl,
  uniqueBettors,
} from "@/lib/bets";
import type { BetsActor } from "@/lib/session";


type FilterState = {
  tab: BetTab;
  window: BetWindow;
  sport: string;
  who: string;
};

type Props = {
  document: BetsDocument;
  bets: BetRow[];
  allBets: BetRow[];
  window: BetWindow;
  sport: string;
  who: string;
  sports: string[];
  kpis: BettorKpis[];
  combined: BettorKpis;
};

export function BetsTabs({
  tab,
  window,
  sport,
  who,
}: FilterState) {
  return (
    <nav className="bets-tabs" aria-label="Bet tracker sections">
      {BET_TABS.map((key) => (
        <Link
          key={key}
          href={betsHref({ tab: key, window, sport, who })}
          className={tab === key ? "is-active" : undefined}
        >
          {TAB_LABELS[key]}
        </Link>
      ))}
    </nav>
  );
}

export function BetsToolbar({ actor }: { actor: BetsActor }) {
  return (
    <p className="bets-toolbar">
      <span>
        Signed in as {actor.email}
        {actor.source === "bypass" ? " (dev bypass)" : ""}
      </span>
      {actor.source === "session" ? <SignOutButton /> : null}
    </p>
  );
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
  const hypothetical = isHypothetical1u(kpi.who);
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
      {hypothetical ? (
        <p className="bets-hyp-note">No posted stake or units — P/L is hypothetical 1u.</p>
      ) : null}
      <dl className="bets-dl">
        <div>
          <dt>Win %</dt>
          <dd>{formatPct(kpi.winPct)}</dd>
        </div>
        <div>
          <dt>{hypothetical ? "Hyp. 1u P/L" : "Net P/L $"}</dt>
          <dd>{hypothetical ? formatUnits(kpi.flat1uPl) : formatMoney(kpi.pl)}</dd>
        </div>
        <div>
          <dt>ROI $</dt>
          <dd>{hypothetical ? "—" : formatPct(kpi.roi)}</dd>
        </div>
        <div>
          <dt>Units P/L</dt>
          <dd>{hypothetical ? formatUnits(kpi.flat1uPl) : formatUnits(kpi.unitsPl)}</dd>
        </div>
        <div>
          <dt>Units ROI</dt>
          <dd>{hypothetical ? "—" : formatPct(kpi.unitsRoi)}</dd>
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

export function BreakdownTable({
  caption,
  rows,
  countKey = "bets",
}: {
  caption: string;
  rows: BreakdownRow[];
  countKey?: string;
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
              <th>{countKey === "legs" ? "Legs" : "Bets"}</th>
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
                <td data-label={countKey === "legs" ? "Legs" : "Bets"}>{row.bets}</td>
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
  allBets,
  window,
  sport,
  who,
  sports,
  kpis,
  combined,
}: Props) {
  const feed = recentBets(bets, 50);
  const names = uniqueBettors(allBets);
  const windows = (["all", "cfb", "nfl"] as const).map((key) => ({
    key,
    label: WINDOW_LABELS[key],
  }));
  const focus = who || "all";

  return (
    <div className="bets-board">
      <div className="bets-filters" role="navigation" aria-label="Bet filters">
        <div className="bets-filter-row">
          <span className="bets-filter-label">Bettor</span>
          <Link
            href={betsHref({ tab: "bets", window, sport, who: "" })}
            className={!who ? "is-active" : undefined}
          >
            All
          </Link>
          {names.map((name) => {
            const meta = bettorMeta(name);
            return (
              <Link
                key={name}
                href={betsHref({ tab: "bets", window, sport, who: name })}
                className={who === name ? "is-active" : undefined}
              >
                {meta.name}
              </Link>
            );
          })}
        </div>
        <div className="bets-filter-row">
          <span className="bets-filter-label">Window</span>
          {windows.map((item) => (
            <Link
              key={item.key}
              href={betsHref({ tab: "bets", window: item.key, sport, who })}
              className={window === item.key ? "is-active" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div className="bets-filter-row">
          <span className="bets-filter-label">Sport</span>
          <Link
            href={betsHref({ tab: "bets", window, sport: "", who })}
            className={!sport ? "is-active" : undefined}
          >
            All sports
          </Link>
          {sports.map((name) => (
            <Link
              key={name}
              href={betsHref({ tab: "bets", window, sport: name, who })}
              className={sport === name ? "is-active" : undefined}
            >
              {name}
            </Link>
          ))}
        </div>
        <p className="bets-filter-note">
          Windows use <strong>game date</strong> when present, otherwise the{" "}
          <strong>X post date (CT)</strong>. CFB start is {WINDOW_LABELS.cfb}{" "}
          (2026-08-27); NFL start is {WINDOW_LABELS.nfl} (2026-09-09). Bettors
          come from the Bets tab — no hardcoded list.
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
              href={safeHttpUrl(meta.href) ?? undefined}
              kpi={kpi}
            />
          );
        })}
      </div>
      <p className="bets-h2h-note">
        Combined card is every tracked slip in this filter ({combined.bets}{" "}
        bets). Per-bettor cards stay independent. Breakdowns below follow{" "}
        <strong>{focus === "all" ? "all bettors" : bettorMeta(focus).name}</strong>.
      </p>

      <div className="bets-who-block">
        <h2 className="bets-who-heading">
          {focus === "all" ? "All bettors" : bettorMeta(focus).name}
        </h2>
        <BreakdownTable
          caption="By sport"
          rows={breakdown(bets, (b) => b.sport || "Other")}
        />
        <BreakdownTable caption="Prime time" rows={breakdown(bets, primeBucket)} />
        <BreakdownTable
          caption="Prime-time slot"
          rows={breakdown(
            bets.filter((b) => primeBucket(b) === "Prime time"),
            primeSlot,
          )}
        />
        <BreakdownTable caption="Game day" rows={breakdown(bets, gameWeekday)} />
        <BreakdownTable
          caption="Bet type"
          rows={breakdown(bets, (b) => b.bt || "—")}
        />
        <BreakdownTable
          caption="Single vs multi"
          rows={breakdown(bets, (b) =>
            classifyParlay(b) === "multi" ? "Parlay / SGP / multi" : "Single",
          )}
        />
        <BreakdownTable
          caption="Number of legs"
          rows={breakdown(bets, legsBucket)}
        />
      </div>

      <section className="bets-feed" aria-labelledby="bets-feed-heading">
        <h2 id="bets-feed-heading">Recent bets</h2>
        <p className="bets-filter-note">
          Newest first. Showing {feed.length} of {bets.length} in this filter.
        </p>
        <ol className="bets-feed-list">
          {feed.map((bet) => {
            const href = safeHttpUrl(bet.url);
            return (
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
            KPIs are computed from raw Bets-tab rows only. Summary / By Sport
            formula tabs are ignored. Record splits live on their own tab and
            are read by header names.
          </li>
          <li>
            Trent mostly posts units without odds, so his dollar P/L covers only
            slips with a visible stake.
          </li>
          <li>
            Steve&apos;s totals include bets he placed for friends on his own
            Gamdom account. Large-stake slips dominate his dollar P/L.
          </li>
          <li>
            Pending and Unknown bets are excluded from the record and P/L.
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

export function BetsEmpty() {
  return (
    <p className="empty-note">
      No bet rows in this slice. If this is production, the{" "}
      <code>sj bets</code> job has not written <code>bets/bets.json</code> yet.
    </p>
  );
}
