import Link from "next/link";

/**
 * Season chip row used on league and team pages (roadmap 3.2).
 * Hidden when there is only one season in the index.
 */
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
  return (
    <div className="season-switch" aria-label="Season">
      {seasons.map((season) => (
        <Link
          key={season}
          href={hrefFor(season)}
          className={`season-chip${season === current ? " active" : ""}`}
        >
          {season}
        </Link>
      ))}
    </div>
  );
}
