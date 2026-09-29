import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import type { LeagueSnapshot } from "@/lib/data";
import {
  COMPARE_METRICS,
  MAX_GOALIES,
  compareFreeAgents,
  depthChart,
  evaluateMove,
  formatDelta,
  freeAgentRows,
  teamRows,
  waiverBoard,
  type DecisionContext,
  type DecisionRow,
  type WaiverFilters,
} from "@/lib/hockey-decisions";
import { formatHeight, roleLabel } from "@/lib/hockey-nhl";
import { formatPercent, formatValue } from "@/lib/hockey-values";

export type DecisionQuery = {
  teamId: number | null;
  filters: WaiverFilters;
  ids: string[];
  drop: string | null;
  add: string | null;
};

const WAIVER_ROWS = 50;

function base(league: LeagueSnapshot, view: string): string {
  return `/leagues/${league.league_id}?season=${league.season}&tab=tools&view=${view}`;
}

function teamName(league: LeagueSnapshot, teamId: number | null): string | null {
  return league.teams.find((t) => t.team_id === teamId)?.name ?? null;
}

/** GET form that switches the team (keeps the view). */
function TeamPicker({
  league,
  view,
  teamId,
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  view: string;
  teamId: number | null;
  viewerTeamId?: number;
}) {
  return (
    <form method="get" action={`/leagues/${league.league_id}`} className="table-toolbar">
      <input type="hidden" name="season" value={league.season} />
      <input type="hidden" name="tab" value="tools" />
      <input type="hidden" name="view" value={view} />
      <label>
        Team{" "}
        <select name="team" defaultValue={teamId ?? ""}>
          {league.teams.map((t) => (
            <option key={t.team_id} value={t.team_id}>
              {t.name}
              {t.team_id === viewerTeamId ? " (you)" : ""}
            </option>
          ))}
        </select>
      </label>{" "}
      <button type="submit" className="button secondary">
        Show
      </button>
    </form>
  );
}

function PlayerCell({ row }: { row: DecisionRow }) {
  const role = roleLabel(row.bio);
  return (
    <>
      {row.player.name ?? "—"}
      {row.player.durability?.iron_man ? <span title="Iron man: plays 95%+ of games"> 🦾</span> : null}
      <span className="league-meta">
        {" "}
        · {row.player.position ?? row.group}
        {row.player.nhl_team ? ` · ${row.player.nhl_team}` : ""}
        {role.text !== "—" ? ` · ${role.text}` : ""}
      </span>
    </>
  );
}

function noValues(league: LeagueSnapshot) {
  return (
    <EmptyState title="No hockey player values yet">
      The decision tools read <code>nhl/values.json</code>, written by the hockey
      sync. They appear after the next <code>sj sync</code> for {league.name}.
    </EmptyState>
  );
}

// ---------------------------------------------------------------------------
// 1. waiver board
// ---------------------------------------------------------------------------
export function WaiverBoardView({
  league,
  ctx,
  query,
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  ctx: DecisionContext;
  query: DecisionQuery;
  viewerTeamId?: number;
}) {
  if (!ctx.values) return noValues(league);
  // Top 50 keeps the document under the HTML budget (roadmap 7.11).
  const all = waiverBoard(ctx, query.teamId, query.filters);
  const rows = all.slice(0, WAIVER_ROWS);
  const f = query.filters;
  const href = (patch: Partial<WaiverFilters>) => {
    const next = { ...f, ...patch };
    const params = new URLSearchParams();
    if (query.teamId != null) params.set("team", String(query.teamId));
    if (next.pos !== "all") params.set("pos", next.pos);
    for (const k of ["healthy", "pp", "rookies", "tall", "iron"] as const) {
      if (next[k]) params.set(k, "1");
    }
    const q = params.toString();
    return `${base(league, "waivers")}${q ? `&${q}` : ""}`;
  };
  const chip = (label: string, active: boolean, patch: Partial<WaiverFilters>) => (
    <Link key={label} href={href(patch)} className={`filter-chip${active ? " active" : ""}`}>
      {label}
    </Link>
  );
  const team = teamName(league, query.teamId);
  return (
    <section style={{ marginTop: "0.75rem" }}>
      <TeamPicker league={league} view="waivers" teamId={query.teamId} viewerTeamId={viewerTeamId} />
      <p className="lede" style={{ marginTop: "0.5rem" }}>
        Free agents by per-game value.{" "}
        {team
          ? `"Upgrade" compares each one with the weakest healthy player at the same position on ${team}.`
          : "Pick a team to see upgrades."}{" "}
        Next 7 days = value × that club&rsquo;s games × expected share played.
      </p>
      <div className="table-filters" role="group" aria-label="Filters">
        {chip("All", f.pos === "all", { pos: "all" })}
        {chip("F", f.pos === "F", { pos: "F" })}
        {chip("D", f.pos === "D", { pos: "D" })}
        {chip("G", f.pos === "G", { pos: "G" })}
        {chip("Healthy", f.healthy, { healthy: !f.healthy })}
        {chip("PP only", f.pp, { pp: !f.pp })}
        {chip("Rookies", f.rookies, { rookies: !f.rookies })}
        {chip(`6'3"+`, f.tall, { tall: !f.tall })}
        {chip("Iron men", f.iron, { iron: !f.iron })}
      </div>
      <form method="get" action={`/leagues/${league.league_id}`}>
        <input type="hidden" name="season" value={league.season} />
        <input type="hidden" name="tab" value="tools" />
        <input type="hidden" name="view" value="compare" />
        {query.teamId != null ? <input type="hidden" name="team" value={query.teamId} /> : null}
        <div className="panel table-scroll" style={{ marginTop: "0.75rem" }}>
          <table className="table-cards">
            <thead>
              <tr>
                <th className="narrow">
                  <span className="sr-only">Compare</span>
                </th>
                <th>Player</th>
                <th className="numeric">Value</th>
                <th className="numeric">Upgrade</th>
                <th>Replaces</th>
                <th className="numeric">Next 7d</th>
                <th className="numeric">Plays</th>
                <th className="numeric">Ht</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.espnId}>
                  <td className="narrow" data-label="Compare">
                    <input
                      type="checkbox"
                      name="ids"
                      value={row.espnId}
                      aria-label={`Compare ${row.player.name ?? "player"}`}
                    />
                  </td>
                  <td data-label="Player">
                    <PlayerCell row={row} />
                    {row.injured ? <span className="league-meta"> · injured</span> : null}
                  </td>
                  <td className="numeric" data-label="Value">
                    {formatValue(row.value)}
                  </td>
                  <td className="numeric" data-label="Upgrade">
                    {formatDelta(row.upgrade)}
                  </td>
                  <td data-label="Replaces">
                    {row.upgrade != null && row.upgrade > 0 && row.replaces
                      ? row.replaces.player.name
                      : "—"}
                  </td>
                  <td className="numeric" data-label="Next 7d">
                    {formatValue(row.next7, 1)}
                    {row.games7 != null ? <span className="league-meta"> ({row.games7} GP)</span> : null}
                  </td>
                  <td className="numeric" data-label="Plays">
                    {formatPercent(row.player.durability?.rate)}
                  </td>
                  <td className="numeric" data-label="Ht">
                    {formatHeight(row.bio?.heightIn)}
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr className="table-empty-row">
                  <td colSpan={8}>No free agents match these filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: "0.5rem" }}>
          <button type="submit" className="button">
            Compare selected (2–4)
          </button>
        </p>
      </form>
      {all.length > rows.length ? (
        <p className="league-meta">
          Top {WAIVER_ROWS} of {all.length} by value — narrow with the filters.
        </p>
      ) : null}
      <p className="league-meta">
        No protected players yet — ownership (H7) and member tags (H8) will let the
        board skip players you would never drop.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. compare
// ---------------------------------------------------------------------------
export function CompareView({
  league,
  ctx,
  query,
}: {
  league: LeagueSnapshot;
  ctx: DecisionContext;
  query: DecisionQuery;
}) {
  if (!ctx.values) return noValues(league);
  const cmp = compareFreeAgents(ctx, query.ids);
  const back = `${base(league, "waivers")}${query.teamId != null ? `&team=${query.teamId}` : ""}`;
  if (cmp.rows.length < 2) {
    return (
      <EmptyState title="Pick two to four free agents">
        Tick players on the <Link href={back}>Waiver board</Link> and choose
        &ldquo;Compare selected&rdquo;.
      </EmptyState>
    );
  }
  const fmt = (key: string, v: number | null) =>
    key === "plays" ? formatPercent(v) : key === "age" ? (v == null ? "—" : String(v)) : formatValue(v, key === "value" ? 2 : 1);
  return (
    <section style={{ marginTop: "0.75rem" }}>
      {cmp.verdict ? (
        <p className="lede" style={{ marginTop: 0 }}>
          <strong>{cmp.verdict}</strong>
        </p>
      ) : null}
      <div className="panel table-scroll">
        <table className="table-cards compare-table">
          <thead>
            <tr>
              <th>Metric</th>
              {cmp.rows.map((r) => (
                <th key={r.espnId}>{r.player.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_METRICS.map((m) => (
              <tr key={m.key}>
                <td data-label="Metric">{m.label}</td>
                {cmp.rows.map((r) => {
                  const best = cmp.best[m.key] === r.espnId;
                  return (
                    <td
                      key={r.espnId}
                      data-label={r.player.name ?? ""}
                      className={`numeric${best ? " is-best" : ""}`}
                    >
                      {fmt(m.key, m.get(r))}
                      {best ? <span className="sr-only"> (best)</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td data-label="Metric">Role</td>
              {cmp.rows.map((r) => (
                <td key={r.espnId} data-label={r.player.name ?? ""}>
                  {roleLabel(r.bio).text}
                  {r.bio?.pp && r.bio.pp !== "No PP" ? ` · ${r.bio.pp}` : ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="league-meta">
        Bold = best in the row. <Link href={back}>Back to the waiver board</Link>
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. evaluate a move
// ---------------------------------------------------------------------------
export function MoveView({
  league,
  ctx,
  query,
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  ctx: DecisionContext;
  query: DecisionQuery;
  viewerTeamId?: number;
}) {
  if (!ctx.values) return noValues(league);
  const roster = teamRows(ctx, query.teamId).sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  const agents = freeAgentRows(ctx).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const result = evaluateMove(ctx, query.teamId, query.drop, query.add);
  const option = (r: DecisionRow) =>
    `${r.player.name} (${r.player.position ?? r.group}, ${formatValue(r.value)})`;
  return (
    <section style={{ marginTop: "0.75rem" }}>
      <form method="get" action={`/leagues/${league.league_id}`} className="table-toolbar">
        <input type="hidden" name="season" value={league.season} />
        <input type="hidden" name="tab" value="tools" />
        <input type="hidden" name="view" value="move" />
        <label>
          Team{" "}
          <select name="team" defaultValue={query.teamId ?? ""}>
            {league.teams.map((t) => (
              <option key={t.team_id} value={t.team_id}>
                {t.name}
                {t.team_id === viewerTeamId ? " (you)" : ""}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Drop{" "}
          <select name="drop" defaultValue={query.drop ?? ""}>
            <option value="">Pick a player</option>
            {roster.map((r) => (
              <option key={r.espnId} value={r.espnId}>
                {option(r)}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Add{" "}
          <select name="add" defaultValue={query.add ?? ""}>
            <option value="">Pick a free agent</option>
            {agents.map((r) => (
              <option key={r.espnId} value={r.espnId}>
                {option(r)}
              </option>
            ))}
          </select>
        </label>{" "}
        <button type="submit" className="button">
          Evaluate
        </button>
      </form>
      {!roster.length ? (
        <p className="league-meta">Pick a team first — its roster fills the Drop list.</p>
      ) : null}
      {result ? (
        <div className="panel" style={{ marginTop: "0.75rem" }}>
          <p className="lede" style={{ marginTop: 0 }}>
            <strong>{result.verdict}</strong>
          </p>
          <table className="table-cards">
            <thead>
              <tr>
                <th />
                <th className="numeric">Drop: {result.drop.player.name}</th>
                <th className="numeric">Add: {result.add.player.name}</th>
                <th className="numeric">Change</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Value /G", result.drop.value, result.add.value, result.delta.value, 2],
                  ["Next 14 days", result.drop.next14, result.add.next14, result.delta.next14, 1],
                  ["Rest of season", result.drop.ros, result.add.ros, result.delta.ros, 1],
                ] as const
              ).map(([label, a, b, d, digits]) => (
                <tr key={label}>
                  <td data-label="">{label}</td>
                  <td className="numeric" data-label="Drop">{formatValue(a, digits)}</td>
                  <td className="numeric" data-label="Add">{formatValue(b, digits)}</td>
                  <td className="numeric" data-label="Change">{formatDelta(d, digits)}</td>
                </tr>
              ))}
              <tr>
                <td data-label="">Plays</td>
                <td className="numeric" data-label="Drop">{formatPercent(result.drop.player.durability?.rate)}</td>
                <td className="numeric" data-label="Add">{formatPercent(result.add.player.durability?.rate)}</td>
                <td className="numeric" data-label="Change">
                  {result.delta.plays == null ? "—" : `${formatDelta(result.delta.plays * 100, 0)}%`}
                </td>
              </tr>
            </tbody>
          </table>
          {result.warnings.length ? (
            <ul className="move-warnings">
              {result.warnings.map((w) => (
                <li key={w}>⚠️ {w}</li>
              ))}
            </ul>
          ) : (
            <p className="league-meta">No warnings (goalie limit {MAX_GOALIES}, injuries, positions).</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4. weakest to best
// ---------------------------------------------------------------------------
export function DepthView({
  league,
  ctx,
  query,
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  ctx: DecisionContext;
  query: DecisionQuery;
  viewerTeamId?: number;
}) {
  if (!ctx.values) return noValues(league);
  const groups = depthChart(ctx, query.teamId);
  return (
    <section style={{ marginTop: "0.75rem" }}>
      <TeamPicker league={league} view="depth" teamId={query.teamId} viewerTeamId={viewerTeamId} />
      {!groups.length ? (
        <EmptyState title="No valued players on this roster">Pick another team.</EmptyState>
      ) : null}
      {groups.map((g) => (
        <div key={g.group} className="panel depth-group" style={{ marginTop: "0.75rem" }}>
          <h3 className="roster-group-title" style={{ marginTop: 0 }}>
            {g.label} — weakest first
          </h3>
          <ol className="depth-bars" aria-label={`${g.label} by per-game value`}>
            {g.rows.map((r) => {
              const pct = g.max > 0 && r.value != null ? Math.max(2, (r.value / g.max) * 100) : 0;
              return (
                <li
                  key={r.espnId}
                  className="depth-bar-row"
                  title={`${r.player.name}: ${formatValue(r.value)} per game · plays ${formatPercent(
                    r.player.durability?.rate,
                  )}${r.injured ? " · injured" : ""}`}
                >
                  <span className="depth-bar-name">{r.player.name}</span>
                  <span className="depth-bar-track" aria-hidden="true">
                    <span className="depth-bar-fill" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="depth-bar-value">{formatValue(r.value)}</span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
      <p className="league-meta">Per-game value; hover a bar for share played.</p>
    </section>
  );
}
