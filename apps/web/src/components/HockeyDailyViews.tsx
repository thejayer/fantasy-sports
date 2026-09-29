import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import type { DecisionQuery } from "@/components/HockeyDecisionViews";
import type { LeagueSnapshot } from "@/lib/data";
import type { SlotPointsSnapshot } from "@/lib/baseball-analysis";
import {
  SLOT_LABEL,
  dailyLineup,
  goalieBoard,
  paceTable,
  streamingPlan,
  windowDates,
  type DailyContext,
  type DayPlayer,
} from "@/lib/hockey-daily";
import type { HockeyScheduleSnapshot } from "@/lib/hockey-decisions";
import { formatPercent, formatValue } from "@/lib/hockey-values";

function href(league: LeagueSnapshot, view: string, params: Record<string, string | number | null>) {
  const q = Object.entries(params)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`)
    .join("");
  return `/leagues/${league.league_id}?season=${league.season}&tab=tools&view=${view}${q}`;
}

/** "Wed Oct 15" from an ISO date (UTC, no locale drift between server runs). */
export function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${wd} ${mo} ${d.getUTCDate()}`;
}

function TeamForm({
  league,
  view,
  query,
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  view: string;
  query: DecisionQuery;
  viewerTeamId?: number;
}) {
  return (
    <form method="get" action={`/leagues/${league.league_id}`} className="table-toolbar">
      <input type="hidden" name="season" value={league.season} />
      <input type="hidden" name="tab" value="tools" />
      <input type="hidden" name="view" value={view} />
      {query.date ? <input type="hidden" name="date" value={query.date} /> : null}
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
      <button type="submit" className="button secondary">
        Show
      </button>
    </form>
  );
}

function DateChips({
  league,
  view,
  query,
  dates,
  active,
}: {
  league: LeagueSnapshot;
  view: string;
  query: DecisionQuery;
  dates: string[];
  active: string;
}) {
  return (
    <div className="table-filters" role="group" aria-label="Day">
      {dates.map((d) => (
        <Link
          key={d}
          href={href(league, view, { team: query.teamId, date: d })}
          className={`filter-chip${d === active ? " active" : ""}`}
        >
          {dayLabel(d)}
        </Link>
      ))}
    </div>
  );
}

function gameText(p: DayPlayer): string {
  if (!p.game) return "—";
  return `${p.game.home ? "vs" : "@"} ${p.game.opp}${p.game.b2b ? " (B2B)" : ""}`;
}

function noValues(league: LeagueSnapshot) {
  return (
    <EmptyState title="No hockey player values yet">
      The daily tools read <code>nhl/values.json</code> and{" "}
      <code>nhl/schedule.json</code>, written by the hockey sync. They appear
      after the next <code>sj sync</code> for {league.name}.
    </EmptyState>
  );
}

function pickDate(query: DecisionQuery, dates: string[]): string {
  return query.date && dates.includes(query.date) ? query.date : dates[0]!;
}

// ---------------------------------------------------------------------------
// 5. start / sit
// ---------------------------------------------------------------------------
export function LineupView({
  league,
  ctx,
  query,
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  ctx: DailyContext;
  query: DecisionQuery;
  viewerTeamId?: number;
}) {
  if (!ctx.values || !ctx.schedule) return noValues(league);
  const dates = windowDates(ctx.start);
  const date = pickDate(query, dates);
  const lineup = dailyLineup(ctx, query.teamId, date);
  const openCount = Object.values(lineup.open).reduce((a, b) => a + b, 0);
  return (
    <section style={{ marginTop: "0.75rem" }}>
      <TeamForm league={league} view="lineup" query={{ ...query, date }} viewerTeamId={viewerTeamId} />
      <DateChips league={league} view="lineup" query={query} dates={dates} active={date} />
      <p className="lede" style={{ marginTop: "0.5rem" }}>
        Best lineup for <strong>{dayLabel(date)}</strong>: {formatValue(lineup.total, 1)} expected points
        {openCount ? `, ${openCount} open slot${openCount === 1 ? "" : "s"}` : ""}. Skaters score value ×
        share of games played; goalies use the start model.
        {openCount ? (
          <>
            {" "}
            <Link href={href(league, "streaming", { team: query.teamId })}>Fill them with streamers</Link>.
          </>
        ) : null}
      </p>
      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th>Slot</th>
              <th>Player</th>
              <th>Game</th>
              <th className="numeric">Expected</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {lineup.starters.map(({ slot, player }, i) => (
              <tr key={`${slot}-${i}`}>
                <td data-label="Slot">{slot}</td>
                <td data-label="Player">{player ? player.row.player.name : <span className="league-meta">Open</span>}</td>
                <td data-label="Game">{player ? gameText(player) : "—"}</td>
                <td className="numeric" data-label="Expected">
                  {player ? formatValue(player.expected, 1) : "—"}
                </td>
                <td data-label="Note">
                  {player?.goalie ? `Starts ${formatPercent(player.goalie.odds.p)} · ${player.goalie.odds.basis}` : player?.note ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="roster-group-title">Sits</h3>
      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th>Player</th>
              <th>Game</th>
              <th className="numeric">Expected</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {lineup.bench.map((p) => (
              <tr key={p.row.espnId}>
                <td data-label="Player">
                  {p.row.player.name}
                  <span className="league-meta"> · {p.row.player.position ?? p.row.group}</span>
                </td>
                <td data-label="Game">{gameText(p)}</td>
                <td className="numeric" data-label="Expected">
                  {p.game ? formatValue(p.expected, 1) : "—"}
                </td>
                <td data-label="Why">{p.note ?? (p.expected > 0 ? "Lower expected points" : "—")}</td>
              </tr>
            ))}
            {!lineup.bench.length ? (
              <tr className="table-empty-row">
                <td colSpan={4}>Everyone starts.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="league-meta">
        ESPN locks each player when their game starts; set the lineup on ESPN. GP caps are not applied here — see{" "}
        <Link href={href(league, "pace", { team: query.teamId })}>Games-played pace</Link>.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 6. goalie starts
// ---------------------------------------------------------------------------
const GOALIE_ROWS = 40;

export function GoaliesView({
  league,
  ctx,
  query,
}: {
  league: LeagueSnapshot;
  ctx: DailyContext;
  query: DecisionQuery;
}) {
  if (!ctx.values || !ctx.schedule) return noValues(league);
  const dates = windowDates(ctx.start);
  const date = pickDate(query, dates);
  const rows = goalieBoard(ctx, date).slice(0, GOALIE_ROWS);
  const teamName = (id: number | null) =>
    id == null ? "Free agent" : (league.teams.find((t) => t.team_id === id)?.name ?? `Team ${id}`);
  return (
    <section style={{ marginTop: "0.75rem" }}>
      <DateChips league={league} view="goalies" query={query} dates={dates} active={date} />
      <p className="lede" style={{ marginTop: "0.5rem" }}>
        Every goalie with a game on <strong>{dayLabel(date)}</strong>. Start chance comes from Daily Faceoff when a
        starter is named, else the goalie&rsquo;s share of starts (a back-to-back rests the starter). Points if they
        start: win odds from each club&rsquo;s goals for and against, saves from the opponent&rsquo;s shots,
        shutout odds — scored with this league&rsquo;s weights.
      </p>
      {!ctx.strength ? (
        <p className="league-meta">No team strength synced yet — points fall back to each goalie&rsquo;s value.</p>
      ) : null}
      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th>Goalie</th>
              <th>Game</th>
              <th className="numeric">Start</th>
              <th className="numeric">Win</th>
              <th className="numeric">Saves</th>
              <th className="numeric">GA</th>
              <th className="numeric">SO</th>
              <th className="numeric">If starts</th>
              <th className="numeric">Expected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const m = r.goalie?.model;
              return (
                <tr key={r.row.espnId} className={r.owner === query.teamId ? "is-viewer" : undefined}>
                  <td data-label="Goalie">
                    {r.row.player.name}
                    <span className="league-meta">
                      {" "}
                      · {r.row.player.nhl_team ?? "—"} · {teamName(r.owner)}
                    </span>
                    {r.note ? <span className="league-meta"> · {r.note}</span> : null}
                  </td>
                  <td data-label="Game">{gameText(r)}</td>
                  <td className="numeric" data-label="Start" title={r.goalie?.odds.basis}>
                    {r.goalie ? formatPercent(r.goalie.odds.p) : "—"}
                  </td>
                  <td className="numeric" data-label="Win">
                    {m ? formatPercent(m.win) : "—"}
                  </td>
                  <td className="numeric" data-label="Saves">
                    {m ? formatValue(m.saves, 1) : "—"}
                  </td>
                  <td className="numeric" data-label="GA">
                    {m ? formatValue(m.goalsAgainst, 2) : "—"}
                  </td>
                  <td className="numeric" data-label="SO">
                    {m ? formatPercent(m.shutout) : "—"}
                  </td>
                  <td className="numeric" data-label="If starts">
                    {formatValue(m?.pointsIfStart ?? r.row.value, 1)}
                  </td>
                  <td className="numeric" data-label="Expected">
                    {formatValue(r.expected, 1)}
                  </td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr className="table-empty-row">
                <td colSpan={9}>No NHL games that day.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 7. streaming planner
// ---------------------------------------------------------------------------
export function StreamingView({
  league,
  ctx,
  query,
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  ctx: DailyContext;
  query: DecisionQuery;
  viewerTeamId?: number;
}) {
  if (!ctx.values || !ctx.schedule) return noValues(league);
  const dates = windowDates(ctx.start);
  const plan = streamingPlan(ctx, query.teamId, dates);
  const openText = (open: Record<string, number>) =>
    Object.entries(open)
      .filter(([, n]) => n > 0)
      .map(([s, n]) => `${n} ${s}`)
      .join(", ") || "none";
  return (
    <section style={{ marginTop: "0.75rem" }}>
      <TeamForm league={league} view="streaming" query={query} viewerTeamId={viewerTeamId} />
      <p className="lede" style={{ marginTop: "0.5rem" }}>
        Next 7 days: the slots your best lineup leaves open each day, and the free agents with a game who fill them.
        &ldquo;Adds&rdquo; sums a free agent&rsquo;s expected points on the days they&rsquo;d fill an open slot.
      </p>
      <h3 className="roster-group-title">Best adds this week</h3>
      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th>Player</th>
              <th className="numeric">Adds</th>
              <th className="numeric">Days</th>
              <th className="numeric">Value</th>
            </tr>
          </thead>
          <tbody>
            {plan.week.map((w) => (
              <tr key={w.row.espnId}>
                <td data-label="Player">
                  {w.row.player.name}
                  <span className="league-meta">
                    {" "}
                    · {w.row.player.position ?? w.row.group} · {w.row.player.nhl_team ?? "—"}
                  </span>
                </td>
                <td className="numeric" data-label="Adds">
                  {formatValue(w.points, 1)}
                </td>
                <td className="numeric" data-label="Days">
                  {w.days}
                </td>
                <td className="numeric" data-label="Value">
                  {formatValue(w.row.value)}
                </td>
              </tr>
            ))}
            {!plan.week.length ? (
              <tr className="table-empty-row">
                <td colSpan={4}>No open slots this week — the lineup is full every day.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <h3 className="roster-group-title">Day by day</h3>
      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th>Day</th>
              <th>Open</th>
              <th>Top fits</th>
            </tr>
          </thead>
          <tbody>
            {plan.days.map((d) => (
              <tr key={d.date}>
                <td data-label="Day">
                  <Link href={href(league, "lineup", { team: query.teamId, date: d.date })}>{dayLabel(d.date)}</Link>
                </td>
                <td data-label="Open">{openText(d.open)}</td>
                <td data-label="Top fits">
                  {d.adds.length
                    ? d.adds
                        .map((a) => `${a.player.row.player.name} (${a.slot}, ${formatValue(a.player.expected, 1)})`)
                        .join(" · ")
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 8. GP cap pacing
// ---------------------------------------------------------------------------
export function PaceView({
  league,
  slotPoints,
  schedule,
  query,
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  slotPoints: SlotPointsSnapshot | null | undefined;
  schedule: HockeyScheduleSnapshot | null | undefined;
  query: DecisionQuery;
  viewerTeamId?: number;
}) {
  const table = paceTable(slotPoints, league, schedule, query.teamId);
  const statusText = { under: "Under pace", on: "On pace", over: "Over pace" } as const;
  return (
    <section style={{ marginTop: "0.75rem" }}>
      <TeamForm league={league} view="pace" query={query} viewerTeamId={viewerTeamId} />
      {!table ? (
        <EmptyState title="No games-played counts yet">
          Pacing reads games used per lineup slot from <code>analysis/slot_points.json</code> (the season-points
          sync walks ESPN&rsquo;s daily lineups) and the season caps from ESPN settings. It appears after the
          next <code>sj sync</code>.
        </EmptyState>
      ) : (
        <>
          <p className="lede" style={{ marginTop: "0.5rem" }}>
            Day {table.elapsedDays} of {table.seasonDays}. ESPN stops counting a slot once its cap is reached, so
            &ldquo;over pace&rdquo; means games lost late in the season; &ldquo;under&rdquo; means unused starts.
          </p>
          <div className="panel table-scroll">
            <table className="table-cards">
              <thead>
                <tr>
                  <th>Slot</th>
                  <th className="numeric">Used</th>
                  <th className="numeric">Pace now</th>
                  <th className="numeric">Cap</th>
                  <th>Progress</th>
                  <th className="numeric">On track for</th>
                  <th className="numeric">Per day left</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={r.slot}>
                    <td data-label="Slot">{SLOT_LABEL[r.slot]}</td>
                    <td className="numeric" data-label="Used">
                      {Math.round(r.used)}
                    </td>
                    <td className="numeric" data-label="Pace now">
                      {Math.round(r.pace)}
                    </td>
                    <td className="numeric" data-label="Cap">
                      {Math.round(r.cap)}
                    </td>
                    <td data-label="Progress">
                      <span
                        className="pace-track"
                        title={`${Math.round(r.used)} used of ${Math.round(r.cap)}; pace ${Math.round(r.pace)}`}
                      >
                        <span className="pace-fill" style={{ width: `${Math.min(100, (r.used / r.cap) * 100)}%` }} />
                        <span className="pace-mark" style={{ left: `${Math.min(100, (r.pace / r.cap) * 100)}%` }} />
                      </span>
                    </td>
                    <td className="numeric" data-label="On track for">
                      {Math.round(r.projected)}
                    </td>
                    <td className="numeric" data-label="Per day left">
                      {r.perDayLeft == null ? "—" : formatValue(r.perDayLeft, 1)}
                    </td>
                    <td data-label="Status">{statusText[r.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="league-meta">
            Bar = games used; tick = where a straight-line pace would be today. Counts starter slots only (bench and
            IR games never count).
          </p>
        </>
      )}
    </section>
  );
}
