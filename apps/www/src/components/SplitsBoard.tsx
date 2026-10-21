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
  displayWho,
  fadeTone,
  filterSplitRows,
  groupSplitsByWho,
  splitLabel,
  uniqueSplitBettors,
  uniqueSplitSports,
  type SplitRow,
  type SplitsDocument,
} from "@/lib/bets-splits";

type Props = {
  document: SplitsDocument;
  window: BetWindow;
  sport: string;
  who: string;
};

function fadeClass(row: SplitRow): string | undefined {
  const tone = fadeTone(row);
  if (tone === "edge") return "is-fade-edge";
  if (tone === "plus") return "is-fade-plus";
  return undefined;
}

function SplitTable({
  caption,
  rows,
  showSport = false,
}: {
  caption: string;
  rows: SplitRow[];
  showSport?: boolean;
}) {
  if (!rows.length) {
    return (
      <section className="bets-breakdown">
        <h3>{caption}</h3>
        <p className="empty-note">No splits in this slice.</p>
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
              <th>Split</th>
              {showSport ? <th>Sport</th> : null}
              <th>W-L-P</th>
              <th>Win %</th>
              <th>1u fade @ −110</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tone = fadeTone(row);
              const key = `${row.who}-${row.kind}-${row.sport ?? ""}-${row.source}`;
              return (
                <tr key={key} className={fadeClass(row)}>
                  <td data-label="Split">{splitLabel(row.kind)}</td>
                  {showSport ? <td data-label="Sport">{row.sport || "—"}</td> : null}
                  <td data-label="W-L-P">{row.record}</td>
                  <td data-label="Win %">{formatPct(row.win_pct)}</td>
                  <td data-label="1u fade @ −110">
                    {formatUnits(row.fade_1u)}
                    {tone === "edge" ? (
                      <span className="bets-fade-flag"> Fade edge</span>
                    ) : tone === "plus" ? (
                      <span className="bets-fade-flag"> Fade +</span>
                    ) : null}
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

export function SplitsBoard({ document, window, sport, who }: Props) {
  const names = uniqueSplitBettors(document.splits);
  const sports = uniqueSplitSports(document.sports);
  const focus = who || ALL_WHO;
  const main = who
    ? filterSplitRows(document.splits, { who })
    : document.splits;
  const groups = groupSplitsByWho(main);
  const sportRows = filterSplitRows(document.sports, {
    who: who || ALL_WHO,
    sport: sport || null,
  }).filter((row) => row.kind !== "other");

  return (
    <div className="bets-board">
      <div className="bets-filters" role="navigation" aria-label="Record split filters">
        <div className="bets-filter-row">
          <span className="bets-filter-label">Bettor</span>
          <Link
            href={betsHref({ tab: "splits", window, sport, who: "" })}
            className={!who ? "is-active" : undefined}
          >
            All
          </Link>
          {names.map((name) => {
            const meta = bettorMeta(name);
            return (
              <Link
                key={name}
                href={betsHref({ tab: "splits", window, sport, who: name })}
                className={who === name ? "is-active" : undefined}
              >
                {meta.name}
              </Link>
            );
          })}
        </div>
        <div className="bets-filter-row">
          <span className="bets-filter-label">Sport</span>
          <Link
            href={betsHref({ tab: "splits", window, sport: "", who })}
            className={!sport ? "is-active" : undefined}
          >
            All sports
          </Link>
          {sports.map((name) => (
            <Link
              key={name}
              href={betsHref({ tab: "splits", window, sport: name, who })}
              className={sport === name ? "is-active" : undefined}
            >
              {name}
            </Link>
          ))}
        </div>
        <p className="bets-filter-note">
          Five slices per bettor from the Record Splits tab: singles vs parlay
          legs, team picks vs player props, plus whole parlay tickets.{" "}
          <strong>1u fade @ −110</strong> is the P/L of fading every graded
          result at −110. Green rows are profitable fades; whole-ticket and
          single player-prop fades get extra emphasis.
        </p>
      </div>

      {groups.map((group) => {
        const meta = group.who === ALL_WHO ? null : bettorMeta(group.who);
        const hyp = isHypothetical1u(group.who);
        return (
          <div key={group.who} className="bets-who-block">
            <h2 className="bets-who-heading">
              {meta ? (
                meta.href ? (
                  <a href={meta.href} rel="noopener noreferrer">
                    {meta.name}
                  </a>
                ) : (
                  meta.name
                )
              ) : (
                displayWho(group.who)
              )}
            </h2>
            {hyp ? (
              <p className="bets-hyp-note">
                No posted stake or units — every P/L here is hypothetical 1u.
              </p>
            ) : null}
            <SplitTable caption="Record splits" rows={group.rows} />
          </div>
        );
      })}

      <SplitTable
        caption={
          sport
            ? `By sport · ${sport}`
            : focus === ALL_WHO
              ? "By sport · all bettors"
              : `By sport · ${bettorMeta(focus).name}`
        }
        rows={sportRows}
        showSport
      />

      {document.checks.length ? (
        <section className="bets-breakdown">
          <h3>Sheet checks</h3>
          <div className="table-scroll">
            <table className="bets-table">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Expected</th>
                  <th>Actual</th>
                  <th>Delta</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {document.checks.map((row) => (
                  <tr key={row.check}>
                    <td data-label="Check">{row.check}</td>
                    <td data-label="Expected">{row.expected || "—"}</td>
                    <td data-label="Actual">{row.actual || "—"}</td>
                    <td data-label="Delta">{row.delta || "—"}</td>
                    <td data-label="Status">{row.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <aside className="bets-caveats" aria-label="Caveats">
        <h2>Caveats</h2>
        <ul>
          <li>
            Splits are read from the Record Splits tab by header names (Bettor,
            Source tab, Class, Sport). Title rows and inserts do not matter —
            we never pin A4:P39.
          </li>
          <li>
            <code>*</code> is the all-bettors rollup from the sheet, not a
            browser-side sum of the per-bettor rows.
          </li>
          <li>
            Lockedin_Sportz (Z-) has no posted stake or units. Any P/L shown
            for him is a hypothetical 1u figure.
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

export function SplitsEmpty() {
  return (
    <p className="empty-note">
      No Record Splits rows yet. If this is production, the{" "}
      <code>sj bets</code> job has not written{" "}
      <code>bets/record_splits.json</code>.
    </p>
  );
}
