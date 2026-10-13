import type { WorkoutVibe } from "@/lib/score";

function pct(at: string, start: string, end: string): number {
  const t = Date.parse(at);
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(t) || b <= a) return 0;
  return Math.min(100, Math.max(0, ((t - a) / (b - a)) * 100));
}

export function TimelineBar({ row }: { row: WorkoutVibe }) {
  const workoutStart = row.workout.start;
  const workoutEnd = row.workout.end;
  const left = pct(workoutStart, row.windowStart, row.windowEnd);
  const right = 100 - pct(workoutEnd, row.windowStart, row.windowEnd);
  return (
    <div className="timeline" aria-label="Workout timeline">
      <div
        className="timeline-window"
        style={{ left: `${left}%`, right: `${right}%` }}
      />
      {row.events.map((event) => (
        <span
          key={event.id}
          className={`timeline-tick ${event.kind}`}
          style={{
            left: `${pct(event.at, row.windowStart, row.windowEnd)}%`,
          }}
          title={`${event.kind}: ${event.title}`}
        />
      ))}
    </div>
  );
}
