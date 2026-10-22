import Link from "next/link";

import {
  betsHref,
  bettorMeta,
  formatPct,
  formatSyncedAt,
  formatUnits,
  isHypothetical1u,
  type BetWindow,
} from "@/lib/bets";
import {
  ALL_WHO,
  signalLabel,
  tailBucket,
  tailSplits,
  uniqueTailBettors,
  uniqueTailValues,
  type TailBucket,
  type TailFilters,
  type TailLeg,
  type TailSignal,
  type TailingDocument,
} from "@/lib/bets-tailing";

type Props = {
  document: TailingDocument;
  legs: TailLeg[];
  window: BetWindow;
  who: string;
  filters: TailFilters;
};

function signalClass(signal: TailSignal): string | undefined {
  if (signal === "tail") return "is-tail-plus";
  if (signal === "avoid") return "is-tail-avoid";
  if (signal === "small_sample") return "is-tail-small";
  return undefined;
}

function TailTable({
  caption,
  rows,
}: {
  caption: string;
  rows: TailBucket[];
}) {
  if (!rows.length) {
    return (
      <section className="bets-breakdown">
        <h3>{caption}</h3>
        <p className="empty-note">No settled legs in this slice.</p>
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
              <th>Bucket</th>
              <th>W-L-P</th>
              <th>Hit %</th>
              <th>Tail @ −110</th>
              <th>Fade @ −110</th>
              <th>Est. BE</th>
              <th>Signal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = row.key || "all";
              return (
                <tr key={key} className={signalClass(row.signal)}>
                  <td data-label="Bucket">{row.key || "All"}</td>
                  <td data-label="W-L-P">{row.record}</td>
                  <td data-label="Hit %">{formatPct(row.hit)}</td>
                  <td data-label="Tail @ −110">{formatUnits(row.tail_110)}</td>
                  <td data-label="Fade @ −110">{formatUnits(row.fade_110)}</td>
                  <td data-label="Est. BE">
                    {row.ticket_implied_be != null
                      ? `${formatPct(row.ticket_implied_be)} est.`
                      : "52.4% at −110"}
                  </td>
                  <td data-label="Signal">
                    <span className={`bets-signal bets-signal-${row.signal}`}>
                      {signalLabel(row.signal)}
                    </span>
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

function ChipRow({
  label,
  allHref,
  allActive,
  items,
}: {
  label: string;
  allHref: string;
  allActive: boolean;
  items: Array<{ key: string; href: string; active: boolean }>;
}) {
  if (!items.length && allActive) return null;
  return (
    <div className="bets-filter-row">
      <span className="bets-filter-label">{label}</span>
      <Link href={allHref} className={allActive ? "is-active" : undefined}>
        All
      </Link>
      {items.map((item) => (
        <Link key={item.key} href={item.href} className={item.active ? "is-active" : undefined}>
          {item.key}
        </Link>
      ))}
    </div>
  );
}

export function TailingBoard({ document, legs, window, who, filters }: Props) {
  const names = uniqueTailBettors(document.legs);
  const sports = uniqueTailValues(document.legs, "sport");
  const picks = uniqueTailValues(document.legs, "pick");
  const plats = uniqueTailValues(document.legs, "platform");
  const sizes = uniqueTailValues(document.legs, "ticket_size");
  const months = uniqueTailValues(document.legs, "month");
  const ous = uniqueTailValues(document.legs, "ou").filter((value) => value === "Over" || value === "Under");
  const hrefBase = {
    tab: "tail" as const,
    window,
    who,
    sport: filters.sport || "",
    pick: filters.pick || "",
    plat: filters.plat || "",
    size: filters.size || "",
    month: filters.month || "",
    ou: filters.ou || "",
  };
  const overall = tailBucket(legs);
  const splits = tailSplits(legs);
  const focus = who || ALL_WHO;
  const meta = focus === ALL_WHO ? null : bettorMeta(focus);
  const hyp = isHypothetical1u(focus);

  return (
    <div className="bets-board">
      <div className="bets-filters" role="navigation" aria-label="Tail-leg filters">
        <div className="bets-filter-row">
          <span className="bets-filter-label">Bettor</span>
          <Link
            href={betsHref({ ...hrefBase, who: "" })}
            className={!who ? "is-active" : undefined}
          >
            All
          </Link>
          {names.map((name) => (
            <Link
              key={name}
              href={betsHref({ ...hrefBase, who: name })}
              className={who === name ? "is-active" : undefined}
            >
              {bettorMeta(name).name}
            </Link>
          ))}
        </div>
        <ChipRow
          label="Sport"
          allHref={betsHref({ ...hrefBase, sport: "" })}
          allActive={!filters.sport}
          items={sports.map((name) => ({
            key: name,
            href: betsHref({ ...hrefBase, sport: name }),
            active: filters.sport === name,
          }))}
        />
        <ChipRow
          label="Pick group"
          allHref={betsHref({ ...hrefBase, pick: "" })}
          allActive={!filters.pick}
          items={picks.map((name) => ({
            key: name,
            href: betsHref({ ...hrefBase, pick: name }),
            active: filters.pick === name,
          }))}
        />
        <ChipRow
          label="Platform"
          allHref={betsHref({ ...hrefBase, plat: "" })}
          allActive={!filters.plat}
          items={plats.map((name) => ({
            key: name,
            href: betsHref({ ...hrefBase, plat: name }),
            active: filters.plat === name,
          }))}
        />
        <ChipRow
          label="Ticket size"
          allHref={betsHref({ ...hrefBase, size: "" })}
          allActive={!filters.size}
          items={sizes.map((name) => ({
            key: name,
            href: betsHref({ ...hrefBase, size: name }),
            active: filters.size === name,
          }))}
        />
        <ChipRow
          label="Month"
          allHref={betsHref({ ...hrefBase, month: "" })}
          allActive={!filters.month}
          items={months.map((name) => ({
            key: name,
            href: betsHref({ ...hrefBase, month: name }),
            active: filters.month === name,
          }))}
        />
        <ChipRow
          label="Over/under"
          allHref={betsHref({ ...hrefBase, ou: "" })}
          allActive={!filters.ou}
          items={ous.map((name) => ({
            key: name,
            href: betsHref({ ...hrefBase, ou: name }),
            active: filters.ou === name,
          }))}
        />
        <p className="bets-filter-note">
          Settled parlay legs only (W-L-P; pushes sit in the record, not hit %).{" "}
          <strong>Tail @ −110</strong> is a flat 1u follow of every graded leg;
          fade is the other side. Buckets under 20 graded legs are flagged as a
          small sample. {document.odds_note}
        </p>
      </div>

      <div className="bets-kpi-grid">
        <article className="bets-card">
          <p className="bets-card-kicker">
            {meta ? `@${meta.handle}` : "All bettors"}
          </p>
          <h2>{meta ? meta.name : "All bettors"}</h2>
          <p className="bets-record">{overall.record}</p>
          <dl className="bets-dl">
            <div>
              <dt>Hit %</dt>
              <dd>{formatPct(overall.hit)}</dd>
            </div>
            <div>
              <dt>Tail @ −110</dt>
              <dd>{formatUnits(overall.tail_110)}</dd>
            </div>
            <div>
              <dt>Fade @ −110</dt>
              <dd>{formatUnits(overall.fade_110)}</dd>
            </div>
            <div>
              <dt>Breakeven</dt>
              <dd>52.4% at −110</dd>
            </div>
            <div>
              <dt>Graded</dt>
              <dd>{overall.n}</dd>
            </div>
            <div>
              <dt>Est. ticket BE</dt>
              <dd>
                {overall.ticket_implied_be != null
                  ? `${formatPct(overall.ticket_implied_be)} · ${overall.ticket_implied_n} legs`
                  : "—"}
              </dd>
            </div>
          </dl>
        </article>
      </div>

      {hyp ? (
        <p className="bets-hyp-note">
          Lockedin_Sportz (Z-) has no posted stake or units — every P/L here is
          a hypothetical 1u figure.
        </p>
      ) : null}

      <div className="bets-who-block">
        <h2 className="bets-who-heading">
          {focus === ALL_WHO ? "All bettors" : bettorMeta(focus).name}
        </h2>
        <TailTable caption="By sport" rows={splits.sport} />
        <TailTable caption="Team pick vs player prop" rows={splits.pick_group} />
        <TailTable caption="Prop over vs under" rows={splits.direction} />
        <TailTable caption="Prop stat category" rows={splits.stat} />
        <TailTable caption="PrizePicks vs sportsbook" rows={splits.platform} />
        <TailTable caption="Parent ticket size" rows={splits.ticket_size} />
        <TailTable caption="Month" rows={splits.month} />
        <TailTable caption="Team pick type" rows={splits.leg_type} />
      </div>

      <aside className="bets-caveats" aria-label="Caveats">
        <h2>Caveats</h2>
        <ul>
          <li>
            Joined from the Parlay Legs tab to the Bets tab by parent bet id
            (header names / Bettor key — never fixed rows).
          </li>
          <li>
            −110 tail and fade units are approximate. Most leg-odds cells are
            blank or the literal <code>Value</code> placeholder.
          </li>
          <li>
            When a parent parlay has a posted price, that price is split evenly
            across its legs (decimal to the 1/n power) and labeled as an
            estimate. Moneyline favorites need more than 52.4% to break even.
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

export function TailingEmpty() {
  return (
    <p className="empty-note">
      No tailing-leg rows yet. If this is production, the{" "}
      <code>sj bets</code> job has not written{" "}
      <code>bets/tailing_legs.json</code>.
    </p>
  );
}
