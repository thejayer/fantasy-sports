"use client";

import { useState } from "react";

/** Admin "Post injury news to Discord" (HOCKEY-PORT.md H6). */
export function HockeyInjuryDigestButton({
  leagueId,
  season,
  enabled,
}: {
  leagueId: string;
  season: number;
  enabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/injury-digest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ season }),
      });
      const payload = (await res.json()) as { error?: string; sent?: number };
      if (!res.ok) {
        setError(payload.error || `Discord post failed (${res.status})`);
        return;
      }
      const n = payload.sent ?? 0;
      setMessage(n ? `Posted ${n} injury update${n === 1 ? "" : "s"} to Discord.` : "Nothing new to post.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discord post failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ padding: "0.75rem 1rem", marginTop: "0.75rem" }}>
      <p className="league-meta" style={{ marginTop: 0 }}>
        Admin: post the last 3 days of injury news for rostered players to the league Discord. Each update is
        posted once.
        {enabled ? null : (
          <>
            {" "}
            Off until the hub runs with <code>SJ_HOCKEY_INJURY_DISCORD=1</code>.
          </>
        )}
      </p>
      <button type="button" className="button secondary" disabled={busy || !enabled} onClick={() => void send()}>
        {busy ? "Posting…" : "Post injury news to Discord"}
      </button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="league-meta" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
