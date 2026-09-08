import Image from "next/image";
import Link from "next/link";

import {
  buildPortalPulse,
  crewInitials,
  formatPortalEventChip,
  hasPalworldJoinContent,
  portalCopy,
  readyCrewMembers,
  upcomingPortalEvents,
  type DestinationId,
} from "@/lib/content";
import { getSiteConfig } from "@/lib/site";
import { loadWatchPlaylist } from "@/lib/watch";

type Destination = {
  id: DestinationId;
  index: string;
  kicker: string;
  title: string;
  body: string;
  href: string | null;
  action: string;
  pending: boolean;
};

function RoomGlyph({ id }: { id: DestinationId }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 28,
    height: 28,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    "aria-hidden": true as const,
  };
  if (id === "fantasy") {
    return (
      <svg {...common}>
        <path d="M4 19V7l8-4 8 4v12" />
        <path d="M8 19v-6h8v6" />
      </svg>
    );
  }
  if (id === "fitness") {
    return (
      <svg {...common}>
        <path d="M4 10h3l2 8 3-12 2 8h6" />
      </svg>
    );
  }
  if (id === "discord") {
    return (
      <svg {...common}>
        <path d="M7 8h10M7 16h10M8 8c0 5 8 5 8 8" />
        <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (id === "watch") {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="12" />
        <path d="M10 10l5 2-5 2v-4z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function destinationHref(
  id: DestinationId,
  hrefs: {
    fantasyHubUrl: string;
    fitnessUrl: string;
    discordInviteUrl: string | null;
  },
): string | null {
  if (id === "fantasy") return hrefs.fantasyHubUrl;
  if (id === "fitness") return hrefs.fitnessUrl;
  if (id === "discord") return hrefs.discordInviteUrl;
  if (id === "watch") return "/watch";
  if (id === "ai") return "/ai";
  if (id === "people") return "/people";
  return "/palworld";
}

export const revalidate = 1800;

export default async function HomePage() {
  const { fantasyHubUrl, fitnessUrl, discordInviteUrl, palworldStatus } =
    getSiteConfig();
  const copy = portalCopy;
  const items = copy.destinations.items;
  const events = upcomingPortalEvents(copy.events.items);
  const crew = readyCrewMembers(copy.crew.members);
  const playlist = await loadWatchPlaylist(8);
  const pulse = buildPortalPulse({
    nextEvent: events[0] ?? null,
    watchTitle: playlist.feedOk ? (playlist.items[0]?.title ?? null) : null,
    watchCount: playlist.feedOk ? playlist.items.length : null,
    discordInviteUrl,
  });
  const palworldReady = hasPalworldJoinContent(copy.palworld, palworldStatus);
  const hrefs = {
    fantasyHubUrl,
    fitnessUrl,
    discordInviteUrl,
  };

  function buildDestination(id: DestinationId): Destination {
    const item = items[id];
    const href = destinationHref(id, hrefs);
    const pending = id === "palworld" ? !palworldReady : href == null;
    return {
      id,
      index: item.index,
      kicker: item.kicker,
      title: item.title,
      body: item.body,
      href,
      action: pending ? item.actionPending : item.action,
      pending,
    };
  }

  const primary = copy.destinations.primary.map(buildDestination);
  const secondary = copy.destinations.secondary.map(buildDestination);

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

      {pulse.length > 0 ? (
        <section className="pulse-strip" aria-label="Crew pulse">
          <ul className="pulse-strip-inner">
            {pulse.map((cell) => {
              const inner = (
                <>
                  <span className="pulse-kicker">{cell.kicker}</span>
                  <span className="pulse-title">{cell.title}</span>
                  {cell.detail ? (
                    <span className="pulse-detail">{cell.detail}</span>
                  ) : null}
                </>
              );
              return (
                <li key={cell.id}>
                  {cell.external ? (
                    <a
                      className="pulse-cell"
                      href={cell.href}
                      rel="noopener noreferrer"
                    >
                      {inner}
                    </a>
                  ) : cell.href.startsWith("/") ? (
                    <Link className="pulse-cell" href={cell.href}>
                      {inner}
                    </Link>
                  ) : (
                    <a className="pulse-cell" href={cell.href}>
                      {inner}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

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
          <ul className="event-cards">
            {events.map((event) => {
              const chip = formatPortalEventChip(event.date);
              const href =
                event.href ??
                (event.label.toLowerCase().includes("draft") ||
                event.label.toLowerCase().includes("golf") ||
                event.sport === "Football" ||
                event.sport === "Golf"
                  ? fantasyHubUrl
                  : null);
              const cta = event.cta ?? (href ? "Open" : null);
              const inner = (
                <>
                  <span className="event-chip">
                    <span className="event-chip-month">{chip.month}</span>
                    <span className="event-chip-day">{chip.day}</span>
                  </span>
                  <span className="event-main">
                    {event.sport ? (
                      <span className="event-sport">{event.sport}</span>
                    ) : null}
                    <span className="event-label">{event.label}</span>
                    <span className="event-where">{event.where}</span>
                  </span>
                  {cta ? <span className="destination-action">{cta} →</span> : null}
                </>
              );
              return (
                <li key={`${event.date}-${event.label}`}>
                  {href ? (
                    href.startsWith("/") ? (
                      <Link className="event-card" href={href}>
                        {inner}
                      </Link>
                    ) : (
                      <a
                        className="event-card"
                        href={href}
                        rel="noopener noreferrer"
                      >
                        {inner}
                      </a>
                    )
                  ) : (
                    <div className="event-card">{inner}</div>
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
        <ul className="room-grid">
          {primary.map((item) => {
            const className = item.pending
              ? "room-tile is-muted"
              : "room-tile";
            const inner = (
              <>
                <div className="room-tile-top">
                  <span className="room-icon">
                    <RoomGlyph id={item.id} />
                  </span>
                  {item.pending ? (
                    <span className="soon-badge">{item.action}</span>
                  ) : null}
                </div>
                <p className="destination-index">
                  {item.index} · {item.kicker}
                </p>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
                {item.pending ? null : (
                  <div className="destination-action">{item.action} →</div>
                )}
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
        <ul className="room-secondary">
          {secondary.map((item) => {
            const className = item.pending
              ? "room-compact is-muted"
              : "room-compact";
            const inner = (
              <>
                <div className="room-compact-copy">
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
                {item.pending ? (
                  <span className="soon-badge">{item.action}</span>
                ) : (
                  <span className="destination-action">{item.action} →</span>
                )}
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
          <ul className="crew-grid">
            {crew.map((member) => (
              <li key={member.handle}>
                <a
                  className="crew-card"
                  href={`${fantasyHubUrl}/u/${member.handle}`}
                  rel="noopener noreferrer"
                >
                  <span className="crew-avatar" aria-hidden>
                    {member.photo ? (
                      <Image
                        className="crew-avatar-img"
                        src={member.photo}
                        alt=""
                        width={88}
                        height={88}
                      />
                    ) : (
                      <span className="crew-monogram">
                        {crewInitials(member.name)}
                      </span>
                    )}
                  </span>
                  <h3>
                    {member.mark ? (
                      <span className="crew-mark">{member.mark}</span>
                    ) : null}
                    {member.name}
                  </h3>
                  <p className="crew-handle">@{member.handle}</p>
                  <p>{member.blurb}</p>
                  <span className="destination-action">Profile →</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="site-footer">
        <span>{copy.footer.left}</span>
        <span>
          <a href={fitnessUrl} rel="noopener noreferrer">
            {copy.footer.fitnessLabel} →
          </a>
          {" · "}
          <a href={fantasyHubUrl} rel="noopener noreferrer">
            {copy.footer.fantasyLabel} →
          </a>
        </span>
      </footer>
    </main>
  );
}
