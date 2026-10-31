"use client";

import { useState } from "react";

import { CasinoApiError, casinoApi } from "@/lib/casino-api-client";
import type { ModLinkRow } from "@/lib/profile-links";
import { useCasinoJson } from "@/lib/use-casino-json";

/**
 * Moderators only: every claimed team with who claimed it, and a remove action
 * for a wrong claim. This page only renders it for a mod, but the casino
 * re-checks moderator status on every one of these requests.
 */
export function ModLinks() {
  const { data, error, reload, setError } = useCasinoJson<{ links: ModLinkRow[] }>("api/links/all", "Couldn't load the list.");
  const rows = data?.links ?? null;
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async (row: ModLinkRow) => {
    setBusy(true);
    try {
      await casinoApi("api/links", { method: "DELETE", body: JSON.stringify({ league: row.league, team: row.team }) });
    } catch (err) {
      setError(err instanceof CasinoApiError ? err.message : "Couldn't remove it.");
    } finally {
      setAsking(null);
      await reload();
      setBusy(false);
    }
  };

  return (
    <div data-testid="mod-links">
      <p className="acct-lede">
        Every team link, with who claimed it. Remove one if the wrong person claimed a team. They stop earning for it
        and the team opens up again.
      </p>
      {error ? <p className="acct-alert" role="alert">{error}</p> : null}
      {!rows && !error ? <div className="acct-skeleton" aria-busy="true" /> : null}
      {rows?.length === 0 ? <p className="acct-muted">Nobody has linked a team yet.</p> : null}
      <ul className="acct-mod-list">
        {rows?.map((row) => {
          const key = `${row.league}/${row.team}`;
          return (
            <li key={key} className="acct-mod-row" data-testid="mod-link-row">
              <div className="acct-team-row">
                <span className="acct-team-text">
                  <span className="acct-team-name">{row.label}</span>
                  <span className="acct-team-sub">
                    {row.leagueName} · claimed by {row.name}
                  </span>
                  <span className="acct-team-sub">Team owner: {row.owner || "unknown"}</span>
                </span>
                {asking !== key ? (
                  <button
                    type="button"
                    className="acct-btn acct-btn-sm"
                    aria-label={`Remove ${row.name}'s link to ${row.label}`}
                    onClick={() => setAsking(key)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              {asking === key ? (
                <div className="acct-confirm" data-testid="mod-remove-confirm">
                  <p className="acct-confirm-title">
                    Remove {row.name}&apos;s link to {row.label}?
                  </p>
                  <div className="acct-confirm-actions">
                    <button type="button" className="acct-btn" onClick={() => setAsking(null)}>
                      Cancel
                    </button>
                    <button type="button" className="acct-btn acct-btn-danger" disabled={busy} onClick={() => remove(row)} autoFocus>
                      Remove link
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
