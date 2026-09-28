/**
 * Explains the roster status dots (roadmap 7.10).
 *
 * The dots carried a `title` attribute only, which is invisible on touch and
 * unexplained everywhere — colour alone is not an accessible signal, and nothing
 * on any screen said what green, amber, or red meant.
 */
export function StatusLegend({ sport }: { sport: string }) {
  const bad =
    sport === "baseball" ? "Out or on the IL" : "Out or on injured reserve";
  const warn =
    sport === "baseball" ? "Day-to-day" : "Questionable or doubtful";
  return (
    <ul className="status-legend" aria-label="Player status key">
      <li>
        <span className="status-dot ok" aria-hidden /> Available
      </li>
      <li>
        <span className="status-dot warn" aria-hidden /> {warn}
      </li>
      <li>
        <span className="status-dot bad" aria-hidden /> {bad}
      </li>
    </ul>
  );
}
