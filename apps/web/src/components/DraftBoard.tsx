import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import type { DraftSimSnapshot } from "@/lib/data";
import { formatProjectionPoints } from "@/lib/projection-join";

function pct(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function roundKeys(snapshot: DraftSimSnapshot): string[] {
  const sample = snapshot.availability[0];
  if (!sample) return [];
  return Object.keys(sample)
    .filter((key) => /^round_\d+$/.test(key))
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
}

export function DraftBoard({
  snapshot,
  leagueId,
  season,
  slot,
  maxSlot,
}: {
  snapshot: DraftSimSnapshot | null;
  leagueId: string;
  season: number;
  slot: number;
  maxSlot: number;
}) {
  const slots = Array.from({ length: Math.max(1, maxSlot) }, (_, i) => i + 1);
  const slotSwitcher = (
    <div className="tabs" style={{ marginTop: "0.5rem" }}>
      {slots.map((value) => (
        <Link
          key={value}
          href={`/leagues/${leagueId}?season=${season}&tab=tools&view=draft&slot=${value}`}
          className={`tab${value === slot ? " active" : ""}`}
        >
          Slot {value}
        </Link>
      ))}
    </div>
  );

  if (!snapshot?.pick_rates?.length) {
    return (
      <div className="draft-board">
        {slotSwitcher}
        <EmptyState title="No draft-sim snapshot for this slot">
          Run <code>ffa export-draft-sim --season {season} --slots {slot}</code>{" "}
          into the hub store (or use committed fixtures under{" "}
          <code>draft_sim/</code>). The hub never calls <code>ffa</code> at
          request time.
        </EmptyState>
      </div>
    );
  }

  const rounds = roundKeys(snapshot);

  return (
    <div className="draft-board">
      <p className="lede" style={{ marginTop: "0.75rem" }}>
        Monte Carlo snake draft from slot {snapshot.user_slot} (
        {snapshot.n_sims} sims, {snapshot.teams} teams,{" "}
        {snapshot.scoring.toUpperCase()} {snapshot.season}). Pick rates are how
        often the engine lands that player; availability is P(still on the
        board) at each of your picks.
      </p>

      {slotSwitcher}

      <h3 style={{ marginTop: "1.25rem" }}>Who you land</h3>
      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th className="numeric">Pick %</th>
              <th className="numeric">Avg Rd</th>
              <th className="numeric">Avg VOR</th>
              <th className="numeric">VOR</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.pick_rates.map((row) => (
              <tr key={row.player_id}>
                <td data-label="Player">{row.player_name ?? row.player_id}</td>
                <td data-label="Pos">{row.position ?? "—"}</td>
                <td data-label="Pick %" className="numeric">
                  {pct(row.pick_rate, 0)}
                </td>
                <td data-label="Avg Rd" className="numeric">
                  {row.avg_round == null ? "—" : row.avg_round.toFixed(1)}
                </td>
                <td data-label="Avg VOR" className="numeric">
                  {formatProjectionPoints(row.avg_value)}
                </td>
                <td data-label="VOR" className="numeric">
                  {formatProjectionPoints(row.vor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {snapshot.availability.length ? (
        <>
          <h3 style={{ marginTop: "1.25rem" }}>Availability at your picks</h3>
          <div className="panel table-scroll">
            <table className="table-cards">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Pos</th>
                  <th className="numeric">VOR</th>
                  {rounds.map((key) => (
                    <th key={key} className="numeric">
                      R{key.slice(6)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshot.availability.map((row) => (
                  <tr key={row.player_id}>
                    <td data-label="Player">
                      {row.player_name ?? row.player_id}
                    </td>
                    <td data-label="Pos">{row.position ?? "—"}</td>
                    <td data-label="VOR" className="numeric">
                      {formatProjectionPoints(
                        typeof row.vor === "number" ? row.vor : null,
                      )}
                    </td>
                    {rounds.map((key) => {
                      const value = row[key];
                      return (
                        <td
                          key={key}
                          data-label={`R${key.slice(6)}`}
                          className="numeric"
                        >
                          {pct(typeof value === "number" ? value : null, 0)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
