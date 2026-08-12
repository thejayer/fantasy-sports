import Link from "next/link";

import type { OnThisDayMoment } from "@/lib/on-this-day";

/** Home shelf of calendar anniversaries (Track Q — This day in SJ). */
export function ThisDayInSj({
  moments,
  dayLabel,
}: {
  moments: OnThisDayMoment[];
  /** e.g. "September 8" */
  dayLabel: string;
}) {
  if (!moments.length) return null;

  return (
    <section
      className="panel home-this-day"
      aria-labelledby="this-day-heading"
    >
      <h3 id="this-day-heading" className="roster-group-title">
        This day in SJ
      </h3>
      <p className="league-meta" style={{ marginTop: 0 }}>
        {dayLabel} — weeks, moves, and events from the archive that land on
        this calendar day.
      </p>
      <ul className="home-this-day-list">
        {moments.map((moment) => (
          <li key={moment.id}>
            <Link href={moment.href} className="home-this-day-row">
              <div className="home-this-day-meta">
                <span className="home-this-day-title">{moment.title}</span>
                <span className="league-meta">
                  {moment.leagueName}
                  {moment.whenLabel ? ` · ${moment.whenLabel}` : ""}
                </span>
              </div>
              <p className="home-this-day-detail">{moment.detail}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
