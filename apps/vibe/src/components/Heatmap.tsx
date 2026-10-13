import { heatmap } from "@/lib/stats";
import type { WorkoutVibe } from "@/lib/score";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function Heatmap({
  rows,
  timeZone,
}: {
  rows: WorkoutVibe[];
  timeZone: string;
}) {
  const cells = heatmap(rows, timeZone);
  const lookup = new Map(
    cells.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]),
  );
  return (
    <div className="heat" aria-label="Weekday by hour heatmap">
      <span />
      {Array.from({ length: 24 }, (_, hour) => (
        <span key={hour} className="muted">
          {hour % 6 === 0 ? hour : ""}
        </span>
      ))}
      {DAYS.map((label, weekday) => (
        <HeatRow
          key={`${label}-${weekday}`}
          label={label}
          weekday={weekday}
          lookup={lookup}
        />
      ))}
    </div>
  );
}

function HeatRow({
  label,
  weekday,
  lookup,
}: {
  label: string;
  weekday: number;
  lookup: Map<string, { score: number }>;
}) {
  return (
    <>
      <span>{label}</span>
      {Array.from({ length: 24 }, (_, hour) => {
        const cell = lookup.get(`${weekday}:${hour}`);
        const score = cell?.score ?? 0;
        const cls = score >= 6 ? "hot" : score > 0 ? "on" : "";
        return (
          <span
            key={hour}
            className={`heat-cell ${cls}`}
            title={`${label} ${hour}:00 · ${score}`}
          />
        );
      })}
    </>
  );
}
