"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HubMember, HubMemberRole } from "@/lib/hub-members";

type LeagueOption = {
  league_id: string;
  name: string;
  sport: string;
  season: number;
  teams: Array<{
    team_id: number;
    name: string;
    abbrev: string | null;
    owners: string[];
  }>;
};

type Payload = {
  members: HubMember[];
  leagues: LeagueOption[];
  error?: string;
};

export function AdminMembersPanel() {
  const [members, setMembers] = useState<HubMember[]>([]);
  const [leagues, setLeagues] = useState<LeagueOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<HubMemberRole>("member");
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/members", { cache: "no-store" });
    const payload = (await res.json()) as Payload;
    if (!res.ok) throw new Error(payload.error || "failed to load members");
    setMembers(payload.members);
    setLeagues(payload.leagues);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await refresh();
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "failed to load");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const active = useMemo(
    () => members.find((m) => m.email === selected) ?? null,
    [members, selected],
  );

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const payload = (await res.json()) as Payload;
      if (!res.ok) throw new Error(payload.error || "add failed");
      setMembers(payload.members);
      setSelected(email.trim().toLowerCase());
      setEmail("");
      setRole("member");
    } catch (err) {
      setError(err instanceof Error ? err.message : "add failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateRole(nextRole: HubMemberRole) {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: active.email, role: nextRole }),
      });
      const payload = (await res.json()) as Payload;
      if (!res.ok) throw new Error(payload.error || "update failed");
      setMembers(payload.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : "update failed");
    } finally {
      setBusy(false);
    }
  }

  async function linkTeam(leagueId: string, teamIdRaw: string) {
    if (!active) return;
    const teamId = Number(teamIdRaw);
    if (!Number.isInteger(teamId) || teamId <= 0) {
      // Clear link for this league.
      const teams = active.teams.filter((t) => t.league_id !== leagueId);
      await saveTeams(teams);
      return;
    }
    const league = leagues.find((l) => l.league_id === leagueId);
    const team = league?.teams.find((t) => t.team_id === teamId);
    const teams = [
      ...active.teams.filter((t) => t.league_id !== leagueId),
      {
        league_id: leagueId,
        team_id: teamId,
        team_name: team?.name,
        league_name: league?.name,
      },
    ];
    await saveTeams(teams);
  }

  async function saveTeams(
    teams: HubMember["teams"],
  ) {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: active.email, teams }),
      });
      const payload = (await res.json()) as Payload;
      if (!res.ok) throw new Error(payload.error || "link failed");
      setMembers(payload.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : "link failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!active) return;
    if (!window.confirm(`Remove ${active.email} from the hub?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/members?email=${encodeURIComponent(active.email)}`,
        { method: "DELETE" },
      );
      const payload = (await res.json()) as Payload;
      if (!res.ok) throw new Error(payload.error || "remove failed");
      setMembers(payload.members);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "remove failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      {error ? (
        <p className="league-meta" role="alert">
          {error}
        </p>
      ) : null}

      <form className="panel" onSubmit={addMember} style={{ padding: "1rem" }}>
        <h3 style={{ marginTop: 0 }}>Add member</h3>
        <p className="league-meta">
          Google account email. Sign-in allowlist ={" "}
          <code>ALLOWED_EMAILS</code> ∪ members saved here.
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            alignItems: "end",
          }}
        >
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="member@gmail.com"
              style={{ display: "block", minWidth: "16rem" }}
            />
          </label>
          <label>
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as HubMemberRole)}
              style={{ display: "block" }}
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button className="button" type="submit" disabled={busy}>
            Add
          </button>
        </div>
      </form>

      <div className="panel table-scroll">
        <h3 style={{ margin: "0.75rem 1rem 0" }}>Members</h3>
        {members.length === 0 ? (
          <p className="league-meta" style={{ padding: "0 1rem 1rem" }}>
            No members file yet — add yourself as <strong>admin</strong> first.
            Until then, anyone on <code>ALLOWED_EMAILS</code> can open this page
            (bootstrap).
          </p>
        ) : (
          <table className="table-cards">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Linked teams</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr
                  key={m.email}
                  style={{
                    cursor: "pointer",
                    outline:
                      selected === m.email ? "2px solid var(--accent, #c45)" : undefined,
                  }}
                  onClick={() => setSelected(m.email)}
                >
                  <td>{m.email}</td>
                  <td>{m.role}</td>
                  <td>
                    {m.teams.length
                      ? m.teams
                          .map(
                            (t) =>
                              `${t.league_name || t.league_id}: ${t.team_name || `#${t.team_id}`}`,
                          )
                          .join(" · ")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {active ? (
        <div className="panel" style={{ padding: "1rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div>
              <h3 style={{ margin: 0 }}>{active.email}</h3>
              <p className="league-meta" style={{ marginBottom: 0 }}>
                Link one franchise per league (from current ESPN/hub snapshots).
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <select
                aria-label="Member role"
                value={active.role}
                disabled={busy}
                onChange={(e) =>
                  void updateRole(e.target.value as HubMemberRole)
                }
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => void remove()}
              >
                Remove
              </button>
            </div>
          </div>

          <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
            {leagues.map((league) => {
              const linked = active.teams.find(
                (t) => t.league_id === league.league_id,
              );
              return (
                <label key={league.league_id}>
                  <span className="league-meta">
                    {league.name}{" "}
                    <span>
                      ({league.sport} · {league.season})
                    </span>
                  </span>
                  <select
                    aria-label={`Team for ${league.name}`}
                    value={linked?.team_id ?? ""}
                    disabled={busy}
                    onChange={(e) =>
                      void linkTeam(league.league_id, e.target.value)
                    }
                    style={{ display: "block", minWidth: "min(100%, 24rem)" }}
                  >
                    <option value="">— not linked —</option>
                    {league.teams.map((team) => (
                      <option key={team.team_id} value={team.team_id}>
                        {team.name}
                        {team.owners?.length
                          ? ` · ${team.owners.join(", ")}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
            {leagues.length === 0 ? (
              <p className="league-meta">
                No leagues in the snapshot store yet. Sync ESPN data or use
                fixtures so teams appear here.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
