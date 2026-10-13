import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import {
  deltaLabel,
  formatWeekChip,
  modelLabel,
  vsApLabel,
  type AiRankingsIndex,
  type AiRankingsSnapshot,
} from "@/lib/ai-rankings";

function signed(value: number | null | undefined): string {
  return deltaLabel(value);
}

function WeekChips({
  index,
  current,
  hrefFor,
}: {
  index: AiRankingsIndex | null;
  current: string | null;
  hrefFor: (week: string) => string;
}) {
  const weeks = index?.weeks ?? [];
  if (weeks.length <= 1) return null;
  return (
    <div className="season-switch" aria-label="Week">
      {weeks.map((week) => (
        <Link
          key={week}
          href={hrefFor(week)}
          className={`season-chip${week === current ? " active" : ""}`}
        >
          {formatWeekChip(week)}
        </Link>
      ))}
    </div>
  );
}

function MoverList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ name?: string | null; rank?: number; delta?: number | null; prev_rank?: number | null }>;
}) {
  if (!rows.length) return null;
  return (
    <div className="ai-rank-movers-col">
      <h3>{title}</h3>
      <ul>
        {rows.map((row) => (
          <li key={`${title}-${row.name}`}>
            <strong>{row.name}</strong>
            <span className="league-meta">
              {row.rank != null ? `#${row.rank}` : ""}
              {row.delta != null && row.delta !== 0
                ? ` ${signed(row.delta)}`
                : row.prev_rank != null
                  ? ` was #${row.prev_rank}`
                  : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AiRankingsBoard({
  snapshot,
  index,
  hrefForWeek,
  emptyTitle,
  emptyBody,
  showAp = false,
  showFull = false,
}: {
  snapshot: AiRankingsSnapshot | null;
  index: AiRankingsIndex | null;
  hrefForWeek: (week: string) => string;
  emptyTitle: string;
  emptyBody: string;
  showAp?: boolean;
  showFull?: boolean;
}) {
  if (!snapshot || !snapshot.rankings.length) {
    const notes = snapshot?.degraded?.length ? snapshot.degraded : [];
    return (
      <div className="ai-rank-board">
        <WeekChips
          index={index}
          current={snapshot?.week_label ?? null}
          hrefFor={hrefForWeek}
        />
        <EmptyState title={emptyTitle}>
          {notes.length ? notes.join(" ") : emptyBody}
        </EmptyState>
      </div>
    );
  }

  const rest = (snapshot.full_rankings ?? []).filter((row) => row.rank > 25);
  const movers = snapshot.movers;
  const showApCol =
    showAp && snapshot.rankings.some((row) => row.ap_rank != null || row.vs_ap != null);

  return (
    <div className="ai-rank-board">
      <WeekChips
        index={index}
        current={snapshot.week_label}
        hrefFor={hrefForWeek}
      />
      {snapshot.degraded?.length ? (
        <p className="ai-rank-degraded" role="status">
          {snapshot.degraded.join(" ")}
        </p>
      ) : null}
      <p className="ai-rank-kicker">
        {formatWeekChip(snapshot.week_label)}
        {snapshot.phase ? ` · ${snapshot.phase.replace("_", " ")}` : ""}
        {" · "}
        {modelLabel(snapshot.model)}
        {snapshot.generated_at
          ? ` · ${snapshot.generated_at.slice(0, 10)}`
          : ""}
      </p>
      {snapshot.headline ? (
        <h2 className="ai-rank-headline">{snapshot.headline}</h2>
      ) : null}
      {snapshot.methodology ? (
        <p className="lede">{snapshot.methodology}</p>
      ) : null}

      {snapshot.last_week_review ? (
        <section className="panel ai-rank-review">
          <h3>What last week got right (and wrong)</h3>
          <p>{snapshot.last_week_review}</p>
        </section>
      ) : null}

      {movers &&
      ((movers.risers?.length ?? 0) +
        (movers.fallers?.length ?? 0) +
        (movers.new?.length ?? 0) +
        (movers.dropped?.length ?? 0)) >
        0 ? (
        <div className="ai-rank-movers">
          <MoverList title="Risers" rows={movers.risers ?? []} />
          <MoverList title="Fallers" rows={movers.fallers ?? []} />
          <MoverList title="New" rows={movers.new ?? []} />
          <MoverList title="Dropped" rows={movers.dropped ?? []} />
        </div>
      ) : null}

      <ol className="recap-rankings ai-rank-list">
        {snapshot.rankings.map((row) => (
          <li key={`${row.rank}-${row.name}`}>
            <div className="recap-rank-head">
              <span className="recap-rank-num">{row.rank}</span>
              <strong>{row.name}</strong>
              {row.record ? <span className="league-meta">{row.record}</span> : null}
              {row.delta != null && row.delta !== 0 ? (
                <span className={`ai-rank-delta${row.delta < 0 ? " down" : " up"}`}>
                  {signed(row.delta)}
                </span>
              ) : null}
              {showApCol && row.ap_rank != null ? (
                <span className="league-meta">
                  AP {row.ap_rank}
                  {row.vs_ap != null && row.vs_ap !== 0
                    ? ` · ${vsApLabel(row.vs_ap)}`
                    : ""}
                </span>
              ) : null}
            </div>
            {row.blurb ? <p>{row.blurb}</p> : null}
            {row.conference || row.points_for != null ? (
              <div className="league-meta">
                {[
                  row.conference,
                  row.points_for != null ? `PF ${row.points_for}` : null,
                  row.points_against != null ? `PA ${row.points_against}` : null,
                  row.standing != null ? `ESPN #${row.standing}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      {showFull && rest.length ? (
        <div className="panel table-scroll" style={{ marginTop: "1.25rem" }}>
          <table className="table-cards">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Record</th>
                <th>Conf</th>
                <th className="numeric">Δ</th>
              </tr>
            </thead>
            <tbody>
              {rest.map((row) => (
                <tr key={`full-${row.rank}-${row.name}`}>
                  <td data-label="#">{row.rank}</td>
                  <td data-label="Team">{row.name}</td>
                  <td data-label="Record">{row.record || "—"}</td>
                  <td data-label="Conf">{row.conference || "—"}</td>
                  <td data-label="Δ" className="numeric">
                    {signed(row.delta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {snapshot.notes?.length ? (
        <p className="league-meta" style={{ marginTop: "1rem" }}>
          {snapshot.notes.join(" ")}
        </p>
      ) : null}
    </div>
  );
}
