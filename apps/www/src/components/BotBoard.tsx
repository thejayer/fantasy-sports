import {
  formatClv,
  formatWeight,
  bankrollMax,
  drivingSignals,
  type BotBoard as BotBoardDoc,
  type BotPick,
} from "@/lib/bets-bot";
import { formatSyncedAt, formatUnits, resultTone } from "@/lib/bets";

function american(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value > 0 ? `+${value}` : String(value);
}

function PickRow({ pick }: { pick: BotPick }) {
  const tone = resultTone(pick.result === "P" ? "Push" : pick.result);
  const drivers = drivingSignals(pick);
  return (
    <article className="bets-feed-item">
      <div className="bets-feed-top">
        <span className={`bets-chip bets-chip-${tone}`}>{pick.result}</span>
        <strong className="bets-feed-who">{pick.selection}</strong>
        <span className="bets-feed-meta">
          {pick.sport} · {pick.market} · {american(pick.american)} · {pick.units}u
          {pick.units_pl != null ? ` · ${formatUnits(pick.units_pl)}` : ""}
          {pick.clv != null ? ` · CLV ${formatClv(pick.clv)}` : ""}
        </span>
      </div>
      <p className="bets-feed-legs">{pick.reason}</p>
      {drivers.length ? (
        <ul className="bets-bot-signals">
          {drivers.map((row) => (
            <li key={row.id}>
              <strong>{row.label || row.id}</strong>{" "}
              <span>w {formatWeight(row.weight)}</span>
              {row.note ? ` — ${row.note}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function BotBoard({ document }: { document: BotBoardDoc }) {
  const max = bankrollMax(document.bankroll_series);
  return (
    <div className="bets-board">
      {document.simulated ? (
        <p className="bets-sim-banner" role="status">
          {document.simulated_label || "Simulated sample data"} — paper betting
          only. SJ Bot is not mixed into the group totals or leaderboards.
        </p>
      ) : (
        <p className="bets-sim-banner is-live" role="status">
          Paper betting only. No real money. SJ Bot is not mixed into the group
          totals or leaderboards.
        </p>
      )}

      <section className="bets-kpi-grid" aria-label="SJ Bot record">
        <article className="bets-card">
          <p className="bets-card-kicker">Paper bettor</p>
          <h2>SJ Bot</h2>
          <p className="bets-record">{document.record}</p>
          <dl className="bets-dl">
            <div>
              <dt>Units P/L</dt>
              <dd>{formatUnits(document.units_pl)}</dd>
            </div>
            <div>
              <dt>Bankroll</dt>
              <dd>{document.bankroll.toFixed(1)}u</dd>
            </div>
            <div>
              <dt>Pending</dt>
              <dd>{document.pending}</dd>
            </div>
            <div>
              <dt>Staking</dt>
              <dd>{document.staking === "kelly" ? "Capped Kelly" : "1u flat"}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section aria-label="Bankroll">
        <h2>Bankroll</h2>
        <ol className="bets-bankroll">
          {document.bankroll_series.map((point) => (
            <li key={point.date} title={`${point.date}: ${point.bankroll.toFixed(1)}u`}>
              <span
                className="bets-bankroll-bar"
                style={{ height: `${Math.max(8, (point.bankroll / max) * 100)}%` }}
              />
              <span className="bets-bankroll-label">{point.date === "start" ? "Start" : point.date.slice(5)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Open paper bets">
        <h2>Open bets</h2>
        {document.open.length ? (
          <div className="bets-feed-list">
            {document.open.map((pick) => (
              <PickRow key={pick.id} pick={pick} />
            ))}
          </div>
        ) : (
          <p className="empty-note">No open paper bets on this slate.</p>
        )}
      </section>

      <section aria-label="Recent graded paper bets">
        <h2>Recent graded bets</h2>
        {document.recent.length ? (
          <div className="bets-feed-list">
            {document.recent.map((pick) => (
              <PickRow key={pick.id} pick={pick} />
            ))}
          </div>
        ) : (
          <p className="empty-note">No graded paper bets yet.</p>
        )}
      </section>

      <section aria-label="Signal weights">
        <h2>Signal weights</h2>
        <div className="table-scroll">
          <table className="bets-table">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Weight</th>
                <th>Hits</th>
                <th>Misses</th>
              </tr>
            </thead>
            <tbody>
              {document.weights.map((row) => (
                <tr key={row.id}>
                  <td data-label="Signal">{row.label || row.id}</td>
                  <td data-label="Weight">{formatWeight(row.weight)}</td>
                  <td data-label="Hits">{row.hits ?? "—"}</td>
                  <td data-label="Misses">{row.misses ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="What I learned">
        <h2>{document.note?.title || "What I learned"}</h2>
        {document.note?.week ? <p className="bets-card-kicker">Week {document.note.week}</p> : null}
        <p className="bets-note-body">{document.note?.body || "No weekly note yet."}</p>
      </section>

      <aside className="bets-caveats" aria-label="Caveats">
        <h2>Caveats</h2>
        <ul>
          <li>Simulation only. SJ Bot never places a real wager and is not a human on the Bets tab.</li>
          <li>
            Lines come from ESPN&apos;s public scoreboard (current ESPN BET numbers). ESPN
            does not publish a historical open — the bot builds its own tape from
            morning snapshots.
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

export function BotEmpty() {
  return (
    <p className="empty-note">
      No SJ Bot board yet. The <code>sj-bets</code> job writes{" "}
      <code>bets/bot/board.json</code> after <code>sj bot seed</code> or the first
      live snapshot / pick / grade pass.
    </p>
  );
}
