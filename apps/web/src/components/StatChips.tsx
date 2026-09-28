import type { PlayerStatLine } from "@/lib/player-profile";

/** Labelled stat chips for detail-page headers (roadmap 7.3). */
export function StatChips({ lines }: { lines: PlayerStatLine[] }) {
  if (!lines.length) return null;
  return (
    <dl className="stat-chips">
      {lines.map((line) => (
        <div className="stat-chip" key={line.label}>
          <dt>{line.label}</dt>
          <dd>{line.value}</dd>
        </div>
      ))}
    </dl>
  );
}
