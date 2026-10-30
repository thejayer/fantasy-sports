"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { CasinoSummary } from "@/lib/casino-summary";

const SUMMARY_URL = "/casino/portal-summary";
const FETCH_TIMEOUT_MS = 8_000;

const chips = new Intl.NumberFormat("en-US");

/**
 * "Casino today" box for the home page: today's three biggest wins and the
 * hottest machines. Members only: the data comes from /casino/portal-summary
 * (signed-in, server-side, cached). Signed out, casino down or slow, or any
 * unexpected response: the box simply isn't there.
 */
export function CasinoToday() {
  const [summary, setSummary] = useState<CasinoSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    fetch(SUMMARY_URL, { signal: controller.signal, credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: CasinoSummary | null) => {
        if (data && Array.isArray(data.top) && Array.isArray(data.hot)) setSummary(data);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  if (!summary) return null;
  const quiet = summary.top.length === 0 && summary.hot.length === 0;

  return (
    <section
      id="casino-today"
      className="section casino-today"
      aria-labelledby="casino-today-heading"
    >
      <div className="section-head">
        <div>
          <h2 id="casino-today-heading">Casino today</h2>
          <p>Biggest wins and hottest machines since midnight, Chicago time.</p>
        </div>
        <Link className="casino-today-open" href="/casino">
          Open the casino →
        </Link>
      </div>
      {quiet ? (
        <p className="empty-note">
          Quiet floor so far today. The first big win takes the top spot.
        </p>
      ) : (
        <div className="casino-today-grid">
          <div className="casino-today-card">
            <h3>Top wins</h3>
            {summary.top.length === 0 ? (
              <p className="casino-today-none">No wins on the board yet.</p>
            ) : (
              <ol className="casino-today-list">
                {summary.top.map((row) => (
                  <li key={row.rank} className="casino-today-row">
                    <span className="casino-today-rank" data-rank={row.rank}>
                      {row.rank}
                    </span>
                    <span className="casino-today-name">{row.name}</span>
                    <span className="casino-today-value">
                      {chips.format(row.value)}
                      <span className="casino-today-unit"> chips</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="casino-today-card">
            <h3>Hot machines</h3>
            {summary.hot.length === 0 ? (
              <p className="casino-today-none">Machines warm up after a few spins.</p>
            ) : (
              <ul className="casino-today-list">
                {summary.hot.map((row) => (
                  <li key={row.machine} className="casino-today-row">
                    <span className="casino-today-name">{row.name}</span>
                    <span className="casino-today-tag" data-tag={row.tag}>
                      {row.tagLabel}
                    </span>
                    <span className="casino-today-value casino-today-detail">
                      {chips.format(row.spins)} spins · {chips.format(row.wins)} wins
                      {row.jackpots > 0
                        ? ` · ${chips.format(row.jackpots)} ${row.jackpots === 1 ? "jackpot" : "jackpots"}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
