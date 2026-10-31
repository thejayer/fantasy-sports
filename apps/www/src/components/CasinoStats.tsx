"use client";

import { useEffect, useState } from "react";

import { casinoApi } from "@/lib/casino-api-client";
import { statTiles, type StatTile } from "@/lib/profile-stats";

/** Casino numbers for the signed-in member, from the casino's own profile and card endpoints. */
export function CasinoStats() {
  const [tiles, setTiles] = useState<StatTile[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      casinoApi<{ profile?: Record<string, unknown> }>("api/profile"),
      casinoApi<{ card?: Record<string, unknown> }>("api/card"),
    ])
      .then(([p, c]) => {
        if (alive) setTiles(statTiles(p.profile ?? {}, c.card ?? {}));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div data-testid="casino-stats">
      {failed ? <p className="acct-alert" role="alert">Casino stats aren&apos;t available right now.</p> : null}
      {!tiles && !failed ? <div className="acct-skeleton acct-skeleton-tall" aria-busy="true" /> : null}
      {tiles ? (
        <dl className="acct-tiles">
          {tiles.map((t) => (
            <div key={t.id} className="acct-tile" data-stat={t.id}>
              <dt>{t.label}</dt>
              <dd>{t.value}</dd>
              {t.hint ? <p>{t.hint}</p> : null}
            </div>
          ))}
        </dl>
      ) : null}
      <p className="acct-inline-action">
        {/* The casino is a separate app behind this proxy, so this is a full page load, not a client route. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="acct-btn acct-btn-primary" href="/casino/?card=me">
          Open player card
        </a>
        <span className="acct-muted">Your full card, trophies and ranks live in the casino.</span>
      </p>
    </div>
  );
}
