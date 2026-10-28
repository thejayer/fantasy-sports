import Link from "next/link";

import {
  formatMoney,
  formatSyncedAt,
  safeHttpUrl,
} from "@/lib/bets";
import {
  OPTIONS_FOOTNOTE,
  cumulativePlSeries,
  formatClosedRecord,
  formatOptionPct,
  formatOptionPl,
  optionsHref,
  plDisplay,
  traderHref,
  uniqueOptionTraders,
  uniqueOptionValues,
  type CumulativeSeries,
  type OptionTrade,
  type OptionTrader,
  type OptionsDocument,
} from "@/lib/bets-options";

type FilterState = {
  who: string;
  type: string;
  status: string;
};

type Props = {
  document: OptionsDocument;
  trades: OptionTrade[];
  traders: OptionTrader[];
} & FilterState;

const CHART_COLORS = [
  "var(--color-accent)",
  "var(--color-text)",
  "color-mix(in srgb, var(--color-text) 55%, transparent)",
];

function FilterChips({
  label,
  allHref,
  items,
}: {
  label: string;
  allHref: string;
  items: { name: string; href: string; active: boolean }[];
}) {
  const allActive = items.every((item) => !item.active);
  return (
    <div className="bets-filter-row">
      <span className="bets-filter-label">{label}</span>
      <Link href={allHref} className={allActive ? "is-active" : undefined}>
        All
      </Link>
      {items.map((item) => (
        <Link
          key={item.name}
          href={item.href}
          className={item.active ? "is-active" : undefined}
        >
          {item.name}
        </Link>
      ))}
    </div>
  );
}

function TraderCard({ trader, href }: { trader: OptionTrader; href: string }) {
  const xHref = traderHref(trader);
  return (
    <article className="bets-card">
      <p className="bets-card-kicker">
        {trader.handle ? `@${trader.handle}` : "Options"}
      </p>
      <h2>
        <Link href={href}>{trader.name}</Link>
      </h2>
      <p className="bets-record">{formatMoney(trader.pl)}</p>
      <dl className="bets-dl">
        <div>
          <dt>Closed W-L</dt>
          <dd>{formatClosedRecord(trader.wins, trader.losses)}</dd>
        </div>
        <div>
          <dt>Open positions</dt>
          <dd>{trader.open}</dd>
        </div>
        <div>
          <dt>Posted P/L rows</dt>
          <dd>{trader.pl_posted ?? 0}</dd>
        </div>
        <div>
          <dt>Trades</dt>
          <dd>{trader.trades}</dd>
        </div>
        {trader.has_daily_recap ? (
          <>
            <div>
              <dt>Green days</dt>
              <dd>{trader.green_days ?? 0}</dd>
            </div>
            <div>
              <dt>Red days</dt>
              <dd>{trader.red_days ?? 0}</dd>
            </div>
          </>
        ) : null}
      </dl>
      {xHref ? (
        <p className="bets-filter-note">
          <a href={xHref} rel="noopener noreferrer">
            @{trader.handle}
          </a>
          {trader.tracked_since ? ` · tracked since ${trader.tracked_since}` : ""}
        </p>
      ) : trader.tracked_since ? (
        <p className="bets-filter-note">Tracked since {trader.tracked_since}</p>
      ) : null}
    </article>
  );
}

function TraderChart({
  row,
  color,
}: {
  row: CumulativeSeries;
  color: string;
}) {
  const width = 640;
  const height = 180;
  const pad = { top: 16, right: 16, bottom: 24, left: 64 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const values = row.points.map((point) => point.cum);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const y = (value: number) => pad.top + ((max - value) / span) * innerH;
  const count = row.points.length;
  const x = (index: number) =>
    pad.left + (count <= 1 ? innerW / 2 : (index / (count - 1)) * innerW);
  const points = row.points
    .map((point, index) => `${x(index)},${y(point.cum)}`)
    .join(" ");
  return (
    <figure className="options-chart-wrap">
      <figcaption>Cumulative posted P/L — {row.trader}</figcaption>
      <svg
        className="options-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Cumulative posted P/L for ${row.trader}, ordered by post date`}
      >
        <line
          className="options-chart-axis"
          x1={pad.left}
          x2={width - pad.right}
          y1={y(0)}
          y2={y(0)}
        />
        <text className="options-chart-label" x={4} y={pad.top + 4}>
          {formatMoney(max)}
        </text>
        <text className="options-chart-label" x={4} y={height - 8}>
          {formatMoney(min)}
        </text>
        <polyline
          className="options-chart-line"
          points={points}
          style={{ stroke: color }}
        />
      </svg>
    </figure>
  );
}

function OptionsChart({ series }: { series: CumulativeSeries[] }) {
  if (!series.length) {
    return (
      <p className="bets-filter-note">
        No posted P/L yet — blank cells stay not posted and are not charted.
      </p>
    );
  }
  return (
    <div className="options-charts">
      {series.map((row, index) => (
        <TraderChart
          key={row.trader}
          row={row}
          color={CHART_COLORS[index % CHART_COLORS.length]}
        />
      ))}
    </div>
  );
}

export function OptionsBoard({
  document,
  trades,
  traders,
  who,
  type,
  status,
}: Props) {
  const names = uniqueOptionTraders(document.trades);
  const types = uniqueOptionValues(document.trades, "type");
  const statuses = uniqueOptionValues(document.trades, "status");
  const series = cumulativePlSeries(trades);
  const cards = who ? traders.filter((row) => row.name === who) : traders;

  return (
    <div className="bets-board">
      <div className="bets-filters" aria-label="Options filters">
        <FilterChips
          label="Trader"
          allHref={optionsHref({ type, status })}
          items={names.map((name) => ({
            name,
            href: optionsHref({ who: name, type, status }),
            active: who === name,
          }))}
        />
        <FilterChips
          label="Type"
          allHref={optionsHref({ who, status })}
          items={types.map((name) => ({
            name,
            href: optionsHref({ who, type: name, status }),
            active: type === name,
          }))}
        />
        <FilterChips
          label="Status"
          allHref={optionsHref({ who, type })}
          items={statuses.map((name) => ({
            name,
            href: optionsHref({ who, type, status: name }),
            active: status === name,
          }))}
        />
        <p className="bets-filter-note">
          Filters stay on this tab. Totals use posted P/L only — blank cells
          are not posted, and open positions are never marked to market.
        </p>
      </div>

      <div className="bets-kpi-grid">
        {cards.map((trader) => (
          <TraderCard
            key={trader.name}
            trader={trader}
            href={optionsHref({
              who: trader.name === who ? "" : trader.name,
              type,
              status,
            })}
          />
        ))}
      </div>

      <OptionsChart series={series} />

      <section className="bets-feed" aria-labelledby="options-trades-heading">
        <h2 id="options-trades-heading" className="bets-who-heading">
          Trades
        </h2>
        <p className="bets-filter-note">
          {trades.length} of {document.trades.length} rows in this filter.
          {document.simulated ? " Simulated fixture — not live sheet data." : ""}
        </p>
        <div className="table-scroll">
          <table className="bets-table table-cards">
            <caption className="visually-hidden">Options trades</caption>
            <thead>
              <tr>
                <th>Trade</th>
                <th>Trader</th>
                <th>Posted</th>
                <th>Underlying</th>
                <th>Type</th>
                <th>Strike</th>
                <th>Expiry</th>
                <th>P/L</th>
                <th>P/L %</th>
                <th>Status</th>
                <th>Post</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => {
                const href = safeHttpUrl(trade.url);
                const display = plDisplay(trade);
                return (
                  <tr key={trade.id}>
                    <td data-label="Trade">{trade.id}</td>
                    <td data-label="Trader">{trade.trader}</td>
                    <td data-label="Posted">{trade.posted || "—"}</td>
                    <td data-label="Underlying">{trade.underlying || "—"}</td>
                    <td data-label="Type">{trade.type || "—"}</td>
                    <td data-label="Strike">
                      {trade.strike == null ? "—" : trade.strike}
                    </td>
                    <td data-label="Expiry">{trade.expiry || "—"}</td>
                    <td
                      data-label="P/L"
                      className={
                        display === "open"
                          ? "options-pl-open"
                          : display === "not_posted"
                            ? "options-pl-blank"
                            : undefined
                      }
                    >
                      {formatOptionPl(trade)}
                    </td>
                    <td data-label="P/L %">{formatOptionPct(trade.pl_pct)}</td>
                    <td data-label="Status">{trade.status || "—"}</td>
                    <td data-label="Post">
                      {href ? (
                        <a href={href} rel="noopener noreferrer">
                          Source
                        </a>
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

      <aside className="bets-caveats" aria-label="Options caveats">
        <h2>Caveats</h2>
        <ul>
          <li>{document.footnote || OPTIONS_FOOTNOTE}</li>
          <li>
            Options P/L is a separate sidecar and is not part of the human
            betting totals on Bets / Record splits.
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

export function OptionsEmpty() {
  return (
    <p className="empty-note">
      No options rows in this slice. If this is production, set{" "}
      <code>SJ_OPTIONS_SYNC=1</code> and <code>SJ_OPTIONS_SHEET_ID</code> on{" "}
      <code>sj-bets</code>, then re-run the job so it can write{" "}
      <code>bets/options.json</code>.
    </p>
  );
}
