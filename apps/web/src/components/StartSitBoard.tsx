"use client";

import { useMemo, useState } from "react";
import type { ProjectionPlayer, Team } from "@/lib/data";
import {
  rosterWithProjections,
} from "@/lib/decision-tools";
import {
  formatProjectionPoints,
  type PlayerWithProjection,
} from "@/lib/projection-join";

function CompareCard({
  label,
  player,
}: {
  label: string;
  player: PlayerWithProjection | null;
}) {
  const proj = player?.projection;
  return (
    <div className="panel">
      <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>{label}</h3>
      {player ? (
        <>
          <div style={{ fontWeight: 600 }}>
            {player.name ?? player.id}
          </div>
          <div className="league-meta">
            {[player.slot, player.position, player.pro_team]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
          <table className="table-cards" style={{ marginTop: "0.75rem" }}>
            <tbody>
              <tr>
                <td data-label="">Floor</td>
                <td data-label="Floor">{formatProjectionPoints(proj?.floor)}</td>
              </tr>
              <tr>
                <td data-label="">Median</td>
                <td data-label="Median">
                  {formatProjectionPoints(proj?.median)}
                </td>
              </tr>
              <tr>
                <td data-label="">Ceiling</td>
                <td data-label="Ceiling">
                  {formatProjectionPoints(proj?.ceiling)}
                </td>
              </tr>
              <tr>
                <td data-label="">VOR</td>
                <td data-label="VOR">{formatProjectionPoints(proj?.vor)}</td>
              </tr>
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted">Select a player in the roster table.</p>
      )}
    </div>
  );
}

function delta(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) return "—";
  const d = a - b;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}`;
}

export function StartSitBoard({
  teams,
  espnToGsisEntries,
  weeklyEntries,
  initialTeamId,
}: {
  teams: Team[];
  espnToGsisEntries: Array<[string, string]>;
  weeklyEntries: Array<[string, ProjectionPlayer]>;
  initialTeamId: number;
}) {
  const espnToGsis = useMemo(
    () => new Map(espnToGsisEntries),
    [espnToGsisEntries],
  );
  const byGsis = useMemo(() => new Map(weeklyEntries), [weeklyEntries]);
  const [teamId, setTeamId] = useState(initialTeamId);
  const [selected, setSelected] = useState<string[]>([]);

  const team = teams.find((t) => t.team_id === teamId) ?? teams[0];
  const roster = useMemo(
    () =>
      team
        ? rosterWithProjections(team.roster ?? [], espnToGsis, byGsis).sort(
            (a, b) => (b.projection?.median ?? -1) - (a.projection?.median ?? -1),
          )
        : [],
    [team, espnToGsis, byGsis],
  );

  const pickA = roster.find((p) => String(p.id) === selected[0]) ?? null;
  const pickB = roster.find((p) => String(p.id) === selected[1]) ?? null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const mapped = roster.filter((p) => p.projection).length;

  return (
    <div className="start-sit-board" style={{ marginTop: "0.75rem" }}>
      <p className="lede">
        Typical-week posteriors (one bootstrapped historical game per sim) —
        not schedule- or opponent-adjusted. Compare two rostered players for
        start/sit; season totals stay on the Projections tab.
      </p>

      <label style={{ display: "block", marginBottom: "0.75rem" }}>
        Team{" "}
        <select
          value={team?.team_id ?? ""}
          onChange={(e) => {
            setTeamId(Number(e.target.value));
            setSelected([]);
          }}
        >
          {teams.map((t) => (
            <option key={t.team_id} value={t.team_id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <p className="muted" style={{ marginTop: 0 }}>
        Mapped {mapped}/{roster.length}. Click up to two players to compare.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        <CompareCard label="Player A" player={pickA} />
        <CompareCard label="Player B" player={pickB} />
        {pickA?.projection && pickB?.projection ? (
          <div className="panel">
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>
              A − B
            </h3>
            <table className="table-cards">
              <tbody>
                <tr>
                  <td data-label="">Δ Median</td>
                  <td data-label="Δ Median">
                    {delta(pickA.projection.median, pickB.projection.median)}
                  </td>
                </tr>
                <tr>
                  <td data-label="">Δ Floor</td>
                  <td data-label="Δ Floor">
                    {delta(pickA.projection.floor, pickB.projection.floor)}
                  </td>
                </tr>
                <tr>
                  <td data-label="">Δ Ceiling</td>
                  <td data-label="Δ Ceiling">
                    {delta(pickA.projection.ceiling, pickB.projection.ceiling)}
                  </td>
                </tr>
                <tr>
                  <td data-label="">Δ VOR</td>
                  <td data-label="Δ VOR">
                    {delta(pickA.projection.vor, pickB.projection.vor)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th></th>
              <th>Player</th>
              <th>Slot</th>
              <th>Pos</th>
              <th className="numeric">Floor</th>
              <th className="numeric">Med</th>
              <th className="numeric">Ceil</th>
              <th className="numeric">VOR</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((player) => {
              const id = String(player.id);
              const checked = selected.includes(id);
              const proj = player.projection;
              return (
                <tr key={id}>
                  <td data-label="">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(id)}
                      aria-label={`Compare ${player.name ?? id}`}
                    />
                  </td>
                  <td data-label="Player">
                    {player.name ?? id}
                  </td>
                  <td data-label="Slot">{player.slot ?? "—"}</td>
                  <td data-label="Pos">{player.position ?? "—"}</td>
                  <td data-label="Floor" className="numeric">
                    {formatProjectionPoints(proj?.floor)}
                  </td>
                  <td data-label="Med" className="numeric">
                    {formatProjectionPoints(proj?.median)}
                  </td>
                  <td data-label="Ceil" className="numeric">
                    {formatProjectionPoints(proj?.ceiling)}
                  </td>
                  <td data-label="VOR" className="numeric">
                    {formatProjectionPoints(proj?.vor)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
