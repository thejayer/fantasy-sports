import Image from "next/image";

import { portalCopy } from "@/lib/content";
import { getSiteConfig } from "@/lib/site";

type Destination = {
  id: string;
  kicker: string;
  title: string;
  body: string;
  href: string | null;
  action: string;
};

export default function HomePage() {
  const { fantasyHubUrl, discordInviteUrl, palworldInfoUrl } = getSiteConfig();
  const copy = portalCopy;
  const items = copy.destinations.items;

  const destinations: Destination[] = [
    {
      id: "fantasy",
      kicker: items.fantasy.kicker,
      title: items.fantasy.title,
      body: items.fantasy.body,
      href: fantasyHubUrl,
      action: items.fantasy.action,
    },
    {
      id: "discord",
      kicker: items.discord.kicker,
      title: items.discord.title,
      body: items.discord.body,
      href: discordInviteUrl,
      action: discordInviteUrl
        ? items.discord.action
        : items.discord.actionPending,
    },
    {
      id: "palworld",
      kicker: items.palworld.kicker,
      title: items.palworld.title,
      body: items.palworld.body,
      href: palworldInfoUrl,
      action: palworldInfoUrl
        ? items.palworld.action
        : items.palworld.actionPending,
    },
  ];

  return (
    <main>
      <section className="hero" aria-label="Strictly Jayers home">
        <div className="hero-media" aria-hidden>
          <Image
            className="hero-scene"
            src="/hero-scene.svg"
            alt=""
            width={1200}
            height={900}
            priority
          />
        </div>
        <div className="hero-copy">
          <div className="hero-brand">Strictly Jayers</div>
          <h1>{copy.hero.headline}</h1>
          <p>{copy.hero.support}</p>
          <div className="cta-row">
            <a
              className="cta cta-primary"
              href={fantasyHubUrl}
              rel="noopener noreferrer"
            >
              {copy.hero.ctaFantasy}
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

      <section id="destinations" className="section">
        <div className="section-head">
          <h2>{copy.destinations.heading}</h2>
          <p>{copy.destinations.support}</p>
        </div>
        <ul className="destinations">
          {destinations.map((item) => {
            const interactive = Boolean(item.href);
            const className = interactive
              ? "destination"
              : "destination is-muted";
            const inner = (
              <>
                <div className="destination-index">{item.kicker}</div>
                <div className="destination-main">
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
                <div className="destination-action">{item.action}</div>
              </>
            );
            return (
              <li key={item.id}>
                {item.href ? (
                  <a
                    className={className}
                    href={item.href}
                    rel="noopener noreferrer"
                  >
                    {inner}
                  </a>
                ) : (
                  <div className={className}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
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
