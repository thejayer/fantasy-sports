import { EmptyState } from "@/components/EmptyState";
import { ViewerBadge } from "@/components/ViewerBadge";
import type { PlayoffOddsSnapshot } from "@/lib/data";

function pct(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function PlayoffOddsBoard({
  snapshot,
  viewerTeamId,
}: {
  snapshot: PlayoffOddsSnapshot | null;
  viewerTeamId?: number;
}) {
  if (!snapshot?.teams?.length) {
    return (
      <EmptyState title="No playoff-odds snapshot">
        Run <code>ffa export-playoff-odds</code> into the hub store (
        <code>playoff_odds/&#123;league_id&#125;/&#123;season&#125;.json</code>). Do not treat
        season or weekly quantile boards as playoff probabilities.
      </EmptyState>
    );
  }

  const playoffN = snapshot.playoff_team_count ?? 0;
  const seedCols = Array.from({ length: Math.max(0, playoffN) }, (_, i) =>
    String(i + 1),
  );
  const periods = snapshot.periods_simulated?.length
    ? snapshot.periods_simulated.join(", ")
    : "none (standings locked)";

  const allUnmapped =
    snapshot.teams.length > 0 &&
    snapshot.teams.every((row) => (row.mapped_roster ?? 0) === 0);

  return (
    <div className="playoff-odds-board" style={{ marginTop: "0.75rem" }}>
      <p className="lede">
        Make-playoffs Monte Carlo · {snapshot.n_sims} sims ·{" "}
        {snapshot.scoring.toUpperCase()} · as of week {snapshot.as_of_week ?? "—"}{" "}
        · periods simulated: {periods}. Independent typical-week player draws,
        greedy skill lineups (K/DST omitted), fixed rosters — not
        schedule-/waiver-adjusted.
        {!snapshot.periods_simulated?.length
          ? " Remaining H2H schedule is empty, so probabilities are locked to current standings."
          : ""}
        {allUnmapped
          ? " No roster players mapped through the player map — undecided weeks (if any) score as 0–0 ties."
          : ""}
      </p>

      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              <th className="numeric">Make</th>
              <th className="numeric">Avg W</th>
              {seedCols.map((seed) => (
                <th key={seed} className="numeric">
                  Seed {seed}
                </th>
              ))}
              <th className="numeric">Map</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.teams.map((row) => (
              <tr
                key={row.team_id}
                className={row.team_id === viewerTeamId ? "is-viewer" : undefined}
              >
                <td data-label="#">{row.standing_now ?? "—"}</td>
                <td data-label="Team">
                  {row.name ?? row.team_id}
                  {row.team_id === viewerTeamId ? <ViewerBadge /> : null}
                  <div className="league-meta">
                    {row.wins_now ?? 0}-{row.losses_now ?? 0}
                    {row.ties_now ? `-${row.ties_now}` : ""}
                  </div>
                </td>
                <td data-label="Make" className="numeric">
                  {pct(row.make_playoffs, 0)}
                </td>
                <td data-label="Avg W" className="numeric">
                  {row.avg_wins == null ? "—" : row.avg_wins.toFixed(1)}
                </td>
                {seedCols.map((seed) => (
                  <td key={seed} data-label={`Seed ${seed}`} className="numeric">
                    {pct(row.seed_probs?.[seed], 0)}
                  </td>
                ))}
                <td data-label="Map" className="numeric">
                  {row.mapped_roster ?? 0}/{row.rostered ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
