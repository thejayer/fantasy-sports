import Link from "next/link";

/**
 * Season chips on league and team pages (roadmap 3.2), collapsed to the recent
 * few with a disclosure for the rest (roadmap 7.5).
 *
 * Twelve seasons of `football-main` rendered twelve identical chips, which was
 * most of a mobile viewport before any data appeared. `<details>` keeps this a
 * server component and works without JavaScript.
 */

const VISIBLE = 4;

export function visibleSeasons(
  seasons: number[],
  current: number,
  limit = VISIBLE,
): { shown: number[]; hidden: number[] } {
  if (seasons.length <= limit) return { shown: seasons, hidden: [] };
  const shown = seasons.slice(0, limit);
  // The season being viewed must always be visible, even if it is old.
  if (!shown.includes(current) && seasons.includes(current)) {
    shown[limit - 1] = current;
  }
  const shownSet = new Set(shown);
  return { shown, hidden: seasons.filter((season) => !shownSet.has(season)) };
}

export function SeasonSwitcher({
  seasons,
  current,
  hrefFor,
}: {
  seasons: number[];
  current: number;
  hrefFor: (season: number) => string;
}) {
  if (seasons.length <= 1) return null;
  const { shown, hidden } = visibleSeasons(seasons, current);

  return (
    <div className="season-switch" aria-label="Season">
      {shown.map((season) => (
        <Link
          key={season}
          href={hrefFor(season)}
          className={`season-chip${season === current ? " active" : ""}`}
        >
          {season}
        </Link>
      ))}
      {hidden.length ? (
        <details className="chip-overflow">
          <summary className="season-chip">
            {hidden.length} more
          </summary>
          <div className="chip-overflow-menu">
            {hidden.map((season) => (
              <Link key={season} href={hrefFor(season)} className="season-chip">
                {season}
              </Link>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
