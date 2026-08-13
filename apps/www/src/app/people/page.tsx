import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import {
  INFLUENTIAL_PEOPLE,
  PEOPLE_LANE_COPY,
  peopleByLane,
  personInitials,
  xProfileUrl,
} from "@/lib/people";
import { getSiteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "People",
  description:
    "Leadership desk for the accounts the crew actually follows — portraits, bios, and official X links.",
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
          Portraits, bios, and official X profiles — builders, the AI desk, and
          sports. We do not invent handles. Open the account if you want the
          timeline.
        </p>
        <p className="page-hero-meta">
          {INFLUENTIAL_PEOPLE.length} people · portraits from Wikimedia Commons
          where noted
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
            <ul className="people-grid">
              {group.people.map((person) => (
                <li key={person.id} className="people-card">
                  <div className="people-portrait">
                    {person.photo ? (
                      <Image
                        className="people-portrait-img"
                        src={person.photo}
                        alt=""
                        fill
                        sizes="(max-width: 560px) 92vw, (max-width: 900px) 44vw, 330px"
                      />
                    ) : (
                      <div className="people-monogram" aria-hidden="true">
                        {personInitials(person.name)}
                      </div>
                    )}
                  </div>
                  <div className="people-card-body">
                    <p className="people-card-role">{person.role}</p>
                    <h3>{person.name}</h3>
                    <p className="people-handle">@{person.handle}</p>
                    <p className="people-card-bio">{person.bio}</p>
                    {person.photoCredit ? (
                      <p className="people-photo-credit">{person.photoCredit}</p>
                    ) : null}
                    <a
                      className="people-follow"
                      href={xProfileUrl(person.handle)}
                      rel="noopener noreferrer"
                      aria-label={`Follow ${person.name} on X`}
                    >
                      Follow on X →
                    </a>
                  </div>
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
