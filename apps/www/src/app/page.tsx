import Image from "next/image";
import Link from "next/link";

import {
  formatPortalEventDate,
  portalCopy,
  upcomingPortalEvents,
} from "@/lib/content";
import { getSiteConfig } from "@/lib/site";

type Destination = {
  id: string;
  index: string;
  kicker: string;
  title: string;
  body: string;
  href: string | null;
  action: string;
  pending: boolean;
};

export default function HomePage() {
  const { fantasyHubUrl, discordInviteUrl, palworldInfoUrl } = getSiteConfig();
  const copy = portalCopy;
  const items = copy.destinations.items;
  const events = upcomingPortalEvents(copy.events.items);
  const crew = copy.crew.members;

  const destinations: Destination[] = [
    {
      id: "fantasy",
      index: items.fantasy.index,
      kicker: items.fantasy.kicker,
      title: items.fantasy.title,
      body: items.fantasy.body,
      href: fantasyHubUrl,
      action: items.fantasy.action,
      pending: false,
    },
    {
      id: "ai",
      index: items.ai.index,
      kicker: items.ai.kicker,
      title: items.ai.title,
      body: items.ai.body,
      href: "/ai",
      action: items.ai.action,
      pending: false,
    },
    {
      id: "watch",
      index: items.watch.index,
      kicker: items.watch.kicker,
      title: items.watch.title,
      body: items.watch.body,
      href: "/watch",
      action: items.watch.action,
      pending: false,
    },
    {
      id: "discord",
      index: items.discord.index,
      kicker: items.discord.kicker,
      title: items.discord.title,
      body: items.discord.body,
      href: discordInviteUrl,
      action: discordInviteUrl
        ? items.discord.action
        : items.discord.actionPending,
      pending: !discordInviteUrl,
    },
    {
      id: "palworld",
      index: items.palworld.index,
      kicker: items.palworld.kicker,
      title: items.palworld.title,
      body: items.palworld.body,
      href: palworldInfoUrl,
      action: palworldInfoUrl
        ? items.palworld.action
        : items.palworld.actionPending,
      pending: !palworldInfoUrl,
    },
  ];

  return (
    <main>
      <section className="hero" aria-label="Strictly Jayers home">
        <div className="hero-media" aria-hidden>
          <Image
            className="hero-media-img"
            src="/hero-atmosphere.jpg"
            alt=""
            width={1280}
            height={853}
            priority
          />
          <div className="hero-media-wash" />
        </div>
        <div className="hero-copy">
          <p className="hero-kicker">{copy.hero.kicker}</p>
          <div className="hero-brand">
            Strictly
            <br />
            Jayers
          </div>
          <hr className="hero-rule" />
          <h1>{copy.hero.headline}</h1>
          <p>{copy.hero.support}</p>
          <div className="cta-row hero-cta">
            <a
              className="cta cta-primary"
              href={fantasyHubUrl}
              rel="noopener noreferrer"
            >
              {copy.hero.ctaFantasy} →
            </a>
            {discordInviteUrl ? (
              <a
                className="cta cta-secondary"
                href={discordInviteUrl}
                rel="noopener noreferrer"
              >
                {copy.hero.ctaDiscord}
              </a>
            ) : (
              <a className="cta cta-secondary" href="#destinations">
                {copy.hero.ctaExplore}
              </a>
            )}
          </div>
        </div>
      </section>

      <section
        id="events"
        className="section events-section"
        aria-labelledby="events-heading"
      >
        <div className="section-head">
          <div>
            <h2 id="events-heading">{copy.events.heading}</h2>
            <p>{copy.events.support}</p>
          </div>
          <div className="section-marker">{copy.events.marker}</div>
        </div>
        {events.length === 0 ? (
          <p className="empty-note">{copy.events.empty}</p>
        ) : (
          <ul className="event-strip">
            {events.map((event) => {
              const when = formatPortalEventDate(event.date);
              const body = (
                <>
                  <span className="event-when">{when}</span>
                  <span className="event-label">{event.label}</span>
                  <span className="event-where">{event.where}</span>
                </>
              );
              return (
                <li key={`${event.date}-${event.label}`}>
                  {event.href ? (
                    event.href.startsWith("/") ? (
                      <Link className="event-row" href={event.href}>
                        {body}
                      </Link>
                    ) : (
                      <a
                        className="event-row"
                        href={event.href}
                        rel="noopener noreferrer"
                      >
                        {body}
                      </a>
                    )
                  ) : event.label.toLowerCase().includes("draft") ||
                    event.label.toLowerCase().includes("golf") ? (
                    <a
                      className="event-row"
                      href={fantasyHubUrl}
                      rel="noopener noreferrer"
                    >
                      {body}
                    </a>
                  ) : (
                    <div className="event-row">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section id="destinations" className="section">
        <div className="section-head">
          <div>
            <h2>{copy.destinations.heading}</h2>
            <p>{copy.destinations.support}</p>
          </div>
          <div className="section-marker">{copy.destinations.marker}</div>
        </div>
        <ul className="destinations">
          {destinations.map((item) => {
            const className = item.pending
              ? "destination is-muted"
              : "destination";
            const action = item.pending ? (
              <span className="tag tag-outline">{item.action}</span>
            ) : (
              <div className="destination-action">{item.action} →</div>
            );
            const inner = (
              <>
                <div className="destination-index">
                  {item.index} · {item.kicker}
                </div>
                <div className="destination-main">
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
                {action}
              </>
            );
            return (
              <li key={item.id}>
                {item.href ? (
                  item.href.startsWith("/") ? (
                    <a className={className} href={item.href}>
                      {inner}
                    </a>
                  ) : (
                    <a
                      className={className}
                      href={item.href}
                      rel="noopener noreferrer"
                    >
                      {inner}
                    </a>
                  )
                ) : (
                  <div className={className}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section
        id="crew"
        className="section crew-section"
        aria-labelledby="crew-heading"
      >
        <div className="section-head">
          <div>
            <h2 id="crew-heading">{copy.crew.heading}</h2>
            <p>{copy.crew.support}</p>
          </div>
          <div className="section-marker">{copy.crew.marker}</div>
        </div>
        {!crew.length ? (
          <p className="empty-note">{copy.crew.empty}</p>
        ) : (
          <ul className="crew-list">
            {crew.map((member) => (
              <li key={member.handle}>
                <a
                  className="crew-row"
                  href={`${fantasyHubUrl}/u/${member.handle}`}
                  rel="noopener noreferrer"
                >
                  <div className="crew-main">
                    <h3>{member.name}</h3>
                    <p className="crew-handle">@{member.handle}</p>
                    <p>{member.blurb}</p>
                  </div>
                  <span className="destination-action">Profile →</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="site-footer">
        <span>{copy.footer.left}</span>
        <a href={fantasyHubUrl} rel="noopener noreferrer">
          {copy.footer.fantasyLabel} →
        </a>
      </footer>
    </main>
  );
}
