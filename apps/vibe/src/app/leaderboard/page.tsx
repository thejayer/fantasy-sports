import Link from "next/link";
import { redirect } from "next/navigation";

import { Chrome } from "@/components/Chrome";
import { Heatmap } from "@/components/Heatmap";
import { formatWhen } from "@/lib/format";
import { loadVibe } from "@/lib/load";
import { statsByType } from "@/lib/stats";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const loaded = await loadVibe();
  if (!loaded) redirect("/login");
  const { document, rows } = loaded;
  const byType = statsByType(rows);
  const top = [...rows].sort((a, b) => b.score - a.score).slice(0, 12);

  return (
    <Chrome current="history">
      <main className="page">
        <p className="kicker">History</p>
        <h1>Most productive lifts</h1>
        <p className="lede">
          Ranked by Vibe Score — commits×1 + PRs opened×2 + PRs merged×3 +
          reviews×1 + comments×0.5 + agent minutes×0.1.
        </p>
        <section className="card">
          <h2>By workout</h2>
          {top.length === 0 ? (
            <p className="muted">No scored workouts yet.</p>
          ) : (
            top.map((row) => (
              <Link
                key={row.workout.id}
                className="card-row"
                href={`/workouts/${row.workout.id}`}
              >
                <div>
                  <strong>{row.workout.name}</strong>
                  <div className="muted">
                    {formatWhen(row.workout.start, document.settings.timezone)} ·{" "}
                    {row.commits} commits
                  </div>
                </div>
                <span className="score-pill">{row.score}</span>
              </Link>
            ))
          )}
        </section>
        <section className="card">
          <h2>By type</h2>
          {byType.map((row) => (
            <div key={row.type} className="card-row">
              <div>
                <strong>{row.type}</strong>
                <div className="muted">
                  {row.workouts} sessions · {row.commits} commits
                </div>
              </div>
              <span className="score-pill">{row.score}</span>
            </div>
          ))}
        </section>
        <section className="card">
          <h2>Weekday × hour</h2>
          <p className="muted">
            When the session started, in {document.settings.timezone}.
          </p>
          <Heatmap rows={rows} timeZone={document.settings.timezone} />
        </section>
      </main>
    </Chrome>
  );
}
