import { portalCopy } from "@/lib/content";
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
        <p className="hero-kicker">{copy.hero.kicker}</p>
        <div className="hero-brand">
          Strictly
          <br />
          Jayers
        </div>
        <hr className="hero-rule" />
        <h1>{copy.hero.headline}</h1>
        <p>{copy.hero.support}</p>
        <div className="cta-row">
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
              <div className="destination-action">
                {item.action} →
              </div>
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

      <footer className="site-footer">
        <span>{copy.footer.left}</span>
        <a href={fantasyHubUrl} rel="noopener noreferrer">
          {copy.footer.fantasyLabel} →
        </a>
      </footer>
    </main>
  );
}
