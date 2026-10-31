"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CasinoApiError, casinoApi } from "@/lib/casino-api-client";
import { leagueRows, type LinksView, type TeamState } from "@/lib/profile-links";
import { useCasinoJson } from "@/lib/use-casino-json";

type Pending = { kind: "link" | "unlink"; league: string; leagueName: string; team: string; label: string };

const STATE_NOTE: Partial<Record<TeamState, string>> = {
  taken: "Ask a mod if this is yours",
  locked: "Unlink your team to switch",
};

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * Linked teams: pick your own team in each Strictly Jayers league. Moved here
 * from the casino. Uses the casino's own link endpoints (through this site's
 * /casino/api/links), so who may link what, the one-team-per-league rule and
 * the chip grants are decided on the server exactly as before.
 */
export function LinkedTeams() {
  const { data: view, error, reload, setError } = useCasinoJson<LinksView>("api/links", "Couldn't load your teams.");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const say = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 7000);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      say(await work());
    } catch (err) {
      setError(err instanceof CasinoApiError ? err.message : "Something went wrong.");
    } finally {
      setPending(null);
      await reload();
      setBusy(false);
    }
  };

  const link = (p: Pending) =>
    run(async () => {
      await casinoApi("api/links", { method: "POST", body: JSON.stringify({ league: p.league, team: p.team }) });
      return `Linked ${p.label} in ${p.leagueName}.`;
    });
  const unlink = (p: Pending) =>
    run(async () => {
      await casinoApi("api/links", { method: "DELETE", body: JSON.stringify({ league: p.league }) });
      return `Unlinked ${p.label}.`;
    });
  const checkWins = () =>
    run(async () => {
      const out = await casinoApi<{ paid?: number; chips?: number }>("api/links/sync", { method: "POST", body: "{}" });
      const paid = typeof out.paid === "number" ? out.paid : 0;
      return paid > 0 ? `Paid ${new Intl.NumberFormat("en-US").format(paid)} chips for new wins.` : "No new wins to pay yet.";
    });

  const rows = view ? leagueRows(view) : [];
  const anyLinked = (view?.links.length ?? 0) > 0;

  return (
    <div className="acct-linked" data-testid="linked-teams">
      <p className="acct-lede">
        Pick your own team in each Strictly Jayers league. Each matchup win for a team you link pays chips in the
        casino, and wins from before you linked don&apos;t count. One team per league.
      </p>
      {error ? (
        <p className="acct-alert" role="alert" data-testid="links-error">
          {error}
        </p>
      ) : null}
      {toast ? (
        <p className="acct-toast" role="status" data-testid="links-toast">
          {toast}
        </p>
      ) : null}
      {!view && !error ? <div className="acct-skeleton" aria-busy="true" /> : null}
      {view && !view.leagues ? <p className="acct-muted">The team list isn&apos;t available right now.</p> : null}
      {view?.leagues && rows.length === 0 ? <p className="acct-muted">No fantasy leagues to link yet.</p> : null}

      {rows.map((lg) => (
        <section key={lg.league} className="acct-league" data-league={lg.league} aria-label={lg.name}>
          <header className="acct-league-head">
            <h3>{lg.name}</h3>
            <span className={lg.mine ? "acct-chip acct-chip-ok" : "acct-chip"}>
              {lg.mine ? `Linked: ${lg.mine.label}` : `Not linked · ${lg.openCount} open`}
            </span>
          </header>
          <ul className="acct-team-list">
            {lg.teams.map((t) => {
              const asking = pending?.league === lg.league && pending.team === t.team ? pending : null;
              return (
                <li key={t.team} className="acct-team" data-team={t.team} data-state={t.state}>
                  <div className="acct-team-row">
                    <span className={`acct-team-mark${t.state === "mine" ? " is-mine" : ""}`} aria-hidden>
                      {t.state === "mine" ? <Check /> : null}
                    </span>
                    <span className="acct-team-text">
                      <span className="acct-team-name">{t.label}</span>
                      <span className="acct-team-sub">{t.owner || (t.state === "mine" ? "Your team" : "Open team")}</span>
                    </span>
                    {t.state === "mine" ? (
                      <>
                        <span className="acct-chip acct-chip-ok">Linked</span>
                        <button
                          type="button"
                          className="acct-btn acct-btn-sm"
                          disabled={busy}
                          onClick={() => setPending({ kind: "unlink", league: lg.league, leagueName: lg.name, team: t.team, label: t.label })}
                        >
                          Unlink
                        </button>
                      </>
                    ) : t.state === "taken" ? (
                      <span className="acct-chip">Taken</span>
                    ) : t.state === "open" ? (
                      <button
                        type="button"
                        className="acct-btn acct-btn-sm acct-btn-primary"
                        disabled={busy}
                        onClick={() => setPending({ kind: "link", league: lg.league, leagueName: lg.name, team: t.team, label: t.label })}
                      >
                        Link
                      </button>
                    ) : null}
                  </div>
                  {STATE_NOTE[t.state] ? <p className="acct-team-note">{STATE_NOTE[t.state]}</p> : null}
                  {asking ? (
                    <div className="acct-confirm" role="group" aria-label={asking.kind === "link" ? "Confirm link" : "Confirm unlink"} data-testid={asking.kind === "link" ? "link-confirm" : "unlink-confirm"}>
                      <p className="acct-confirm-title">
                        {asking.kind === "link" ? `Link ${asking.label} in ${asking.leagueName}?` : `Unlink ${asking.label}?`}
                      </p>
                      <p className="acct-confirm-body">
                        {asking.kind === "link"
                          ? "Only link the team you manage. Others can't pick it once it's yours, and a moderator can remove a wrong claim."
                          : "You stop earning chips for its wins. You can link a team here again, but wins you miss in between don't count."}
                      </p>
                      <div className="acct-confirm-actions">
                        <button type="button" className="acct-btn" onClick={() => setPending(null)}>
                          {asking.kind === "link" ? "Cancel" : "Keep it"}
                        </button>
                        <button
                          type="button"
                          className={asking.kind === "link" ? "acct-btn acct-btn-primary" : "acct-btn acct-btn-danger"}
                          disabled={busy}
                          onClick={() => (asking.kind === "link" ? link(asking) : unlink(asking))}
                          autoFocus
                        >
                          {asking.kind === "link" ? "Link team" : "Unlink"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {anyLinked ? (
        <div className="acct-inline-action">
          <button type="button" className="acct-btn acct-btn-sm" disabled={busy} onClick={checkWins}>
            Check for new wins
          </button>
          <span className="acct-muted">Wins are also paid when you open the casino.</span>
        </div>
      ) : null}
    </div>
  );
}
