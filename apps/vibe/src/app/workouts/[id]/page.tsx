import { notFound, redirect } from "next/navigation";

import { Chrome } from "@/components/Chrome";
import { TimelineBar } from "@/components/TimelineBar";
import { formatClock, formatDuration, formatWhen, kindLabel } from "@/lib/format";
import { loadVibe } from "@/lib/load";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function WorkoutPage({ params }: Props) {
  const { id } = await params;
  const loaded = await loadVibe();
  if (!loaded) redirect("/login");
  const { document, rows } = loaded;
  const row = rows.find((item) => item.workout.id === id);
  if (!row) notFound();
  const tz = document.settings.timezone;

  return (
    <Chrome current="home">
      <main className="page">
        <p className="kicker">
          {formatWhen(row.workout.start, tz)} · {formatDuration(row.workout.duration_sec)}
        </p>
        <h1>{row.workout.name}</h1>
        <p className="lede">
          Buffer {document.settings.buffer_minutes} min each side. Window{" "}
          {formatClock(row.windowStart, tz)}–{formatClock(row.windowEnd, tz)}.
        </p>
        <section className="stat-grid" aria-label="Vibe counts">
          <div className="stat">
            <div className="stat-value">{row.score}</div>
            <div className="stat-label">Vibe score</div>
          </div>
          <div className="stat">
            <div className="stat-value">{row.commits}</div>
            <div className="stat-label">Commits</div>
          </div>
          <div className="stat">
            <div className="stat-value">{row.prs_opened + row.prs_merged}</div>
            <div className="stat-label">PRs</div>
          </div>
          <div className="stat">
            <div className="stat-value">{row.agent_minutes}</div>
            <div className="stat-label">Agent min (beta)</div>
          </div>
        </section>
        <section className="card">
          <h2>Timeline</h2>
          <TimelineBar row={row} />
          <p className="muted">
            Red ticks are commits. Green are PRs. The dashed band is the
            actual workout; ticks outside it sat in the buffer.
          </p>
        </section>
        <section className="card">
          <h2>During this window</h2>
          {row.events.length === 0 ? (
            <p className="muted">No GitHub activity overlapped this session.</p>
          ) : (
            <ul className="event-list">
              {row.events.map((event) => (
                <li key={event.id}>
                  <a href={event.url || undefined} rel="noreferrer">
                    <div className="kind">{kindLabel(event.kind)}</div>
                    <strong>{event.title}</strong>
                    <div className="muted">
                      {event.repo} · {formatClock(event.at, tz)}
                      {event.additions != null
                        ? ` · +${event.additions}/−${event.deletions ?? 0}`
                        : ""}
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </Chrome>
  );
}
