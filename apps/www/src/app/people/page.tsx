import type { Metadata } from "next";
import Link from "next/link";

import {
  INFLUENTIAL_PEOPLE,
  PEOPLE_LANE_COPY,
  peopleByLane,
  xProfileUrl,
} from "@/lib/people";
import { getSiteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "People",
  description:
    "Influential people the crew actually follows — Elon, Jensen Huang, and the rest — with links to their X accounts.",
};

export default function PeoplePage() {
  const { fantasyHubUrl } = getSiteConfig();
  const groups = peopleByLane(INFLUENTIAL_PEOPLE);

  return (
    <main className="people-page">
      <section className="page-hero" aria-label="People">
        <p className="hero-kicker">Who to follow</p>
        <h1>People</h1>
        <p>
          A short desk of builders, AI, and sports — official X profiles only.
          We do not invent handles. Open the account if you want the timeline.
        </p>
        <p className="page-hero-meta">
          {INFLUENTIAL_PEOPLE.length} people · hand-edited in the portal
        </p>
      </section>

      {groups.map((group) => {
        const copy = PEOPLE_LANE_COPY[group.lane];
        return (
          <section
            key={group.lane}
            className="section"
            aria-labelledby={`${group.lane}-heading`}
          >
            <div className="section-head">
              <div>
                <h2 id={`${group.lane}-heading`}>{copy.heading}</h2>
                <p>{copy.support}</p>
              </div>
              <div className="section-marker">{copy.marker}</div>
            </div>
            <ul className="people-list">
              {group.people.map((person) => (
                <li key={person.id}>
                  <a
                    className="people-row"
                    href={xProfileUrl(person.handle)}
                    rel="noopener noreferrer"
                  >
                    <div className="people-main">
                      <h3>{person.name}</h3>
                      <p className="people-meta">
                        {person.role}
                        {" · "}
                        <span className="people-handle">@{person.handle}</span>
                      </p>
                      <p>{person.blurb}</p>
                    </div>
                    <span className="destination-action">X →</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <footer className="site-footer">
        <Link href="/">← Strictly Jayers</Link>
        <a href={fantasyHubUrl} rel="noopener noreferrer">
          Fantasy hub →
        </a>
      </footer>
    </main>
  );
}
