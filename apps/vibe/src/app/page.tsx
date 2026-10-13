import Link from "next/link";
import { redirect } from "next/navigation";

import { Chrome } from "@/components/Chrome";
import { GitHubRefresh } from "@/components/GitHubRefresh";
import { formatDuration, formatWhen } from "@/lib/format";
import { githubIsStale } from "@/lib/github";
import { loadVibe } from "@/lib/load";
import { homeStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const loaded = await loadVibe();
  if (!loaded) redirect("/login");
  const { document, rows } = loaded;
  const stats = homeStats(rows, document.settings.timezone);
  const setupNeeded =
    !document.ingest.token_hash &&
    !document.github.access_token_enc &&
    document.workouts.length === 0;

  return (
    <Chrome current="home">
      <GitHubRefresh stale={githubIsStale(document.github.last_sync_at)} />
      <main className="page">
        <p className="kicker">This week · {document.settings.timezone}</p>
        <h1>Coded while lifting</h1>
        <p className="lede">
          Workout windows plus a {document.settings.buffer_minutes}-minute
          buffer. Commits, PRs, and beta agent minutes land on the bar.
        </p>
        {setupNeeded ? (
          <section className="empty">
            <h2>Three hooks</h2>
            <p className="lede">
              1. Connect GitHub in Settings. 2. Create an ingest token and
              point Health Auto Export at this host. 3. Or upload an Apple
              Health export.zip.
            </p>
            <Link className="btn btn-accent" href="/settings">
              Open setup
            </Link>
          </section>
        ) : null}
        <section className="stat-grid" aria-label="This week">
          <div className="stat">
            <div className="stat-value">{stats.weekScore}</div>
            <div className="stat-label">Week vibe</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats.weekCommits}</div>
            <div className="stat-label">Commits in the gym</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats.streak}</div>
            <div className="stat-label">Commit streak</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats.codedWorkouts}</div>
            <div className="stat-label">Workouts with code</div>
          </div>
        </section>
        {stats.top ? (
          <section className="card">
            <p className="kicker">Top workout of all time</p>
            <Link className="card-row" href={`/workouts/${stats.top.workout.id}`}>
              <div>
                <strong>{stats.top.workout.name}</strong>
                <div className="muted">
                  {formatWhen(stats.top.workout.start, document.settings.timezone)}{" "}
                  · {stats.top.commits} commits
                </div>
              </div>
              <span className="score-pill">{stats.top.score}</span>
            </Link>
          </section>
        ) : null}
        <section className="card">
          <h2>This week&apos;s sessions</h2>
          {stats.week.length === 0 ? (
            <p className="muted">No workouts in this Sunday–Saturday window.</p>
          ) : (
            stats.week.map((row) => (
              <Link
                key={row.workout.id}
                className="card-row"
                href={`/workouts/${row.workout.id}`}
              >
                <div>
                  <strong>{row.workout.name}</strong>
                  <div className="muted">
                    {formatWhen(row.workout.start, document.settings.timezone)} ·{" "}
                    {formatDuration(row.workout.duration_sec)} · {row.commits}{" "}
                    commits
                    {row.agent_minutes ? ` · ${row.agent_minutes} agent min` : ""}
                  </div>
                </div>
                <span className="score-pill">{row.score}</span>
              </Link>
            ))
          )}
        </section>
      </main>
    </Chrome>
  );
}
