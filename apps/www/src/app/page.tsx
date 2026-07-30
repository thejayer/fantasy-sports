import { getSiteConfig } from "@/lib/site";

type Destination = {
  id: string;
  kicker: string;
  title: string;
  body: string;
  href: string | null;
  action: string;
  external?: boolean;
};

export default function HomePage() {
  const { fantasyHubUrl, discordInviteUrl, palworldInfoUrl } = getSiteConfig();

  const destinations: Destination[] = [
    {
      id: "fantasy",
      kicker: "Fantasy sports",
      title: "Member hub",
      body: "Football, baseball, and golf leagues — standings, tools, drafts, and the seasons that built the group.",
      href: fantasyHubUrl,
      action: "Open fantasy.strictlyjayers.com",
      external: true,
    },
    {
      id: "discord",
      kicker: "Chat",
      title: "Discord",
      body: "The always-on clubhouse for pick talk, server nights, and everything that is not a league page.",
      href: discordInviteUrl,
      action: discordInviteUrl ? "Join the server" : "Invite link coming soon",
      external: true,
    },
    {
      id: "palworld",
      kicker: "Games",
      title: "Palworld",
      body: "Co-op sessions and server details when the group is online — a destination, not a dashboard.",
      href: palworldInfoUrl,
      action: palworldInfoUrl ? "Server info" : "Details coming soon",
      external: true,
    },
  ];

  return (
    <main>
      <section className="hero" aria-label="Strictly Jayers home">
        <div className="hero-brand">Strictly Jayers</div>
        <h1>The community home base.</h1>
        <p>
          One front door for the group — chat, games, and a clear path into the
          fantasy hub when you are ready to manage a league.
        </p>
        <div className="cta-row">
          <a className="cta cta-primary" href={fantasyHubUrl} rel="noopener noreferrer">
            Enter fantasy hub
          </a>
          {discordInviteUrl ? (
            <a
              className="cta cta-secondary"
              href={discordInviteUrl}
              rel="noopener noreferrer"
            >
              Join Discord
            </a>
          ) : (
            <a className="cta cta-secondary" href="#destinations">
              See destinations
            </a>
          )}
        </div>
      </section>

      <section id="destinations" className="section">
        <div className="section-head">
          <h2>Where to go</h2>
          <p>
            Fantasy lives on its own host so Auth.js cookies and league data stay
            isolated. Everything else starts here.
          </p>
        </div>
        <div className="destinations">
          {destinations.map((item) => {
            const interactive = Boolean(item.href);
            const className = interactive
              ? "destination"
              : "destination is-muted";
            const action = (
              <div className="destination-action">
                <span>{item.action}</span>
              </div>
            );
            const inner = (
              <>
                <div className="destination-kicker">{item.kicker}</div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
                {action}
              </>
            );
            if (!item.href) {
              return (
                <div key={item.id} className={className}>
                  {inner}
                </div>
              );
            }
            return (
              <a
                key={item.id}
                className={className}
                href={item.href}
                rel={item.external ? "noopener noreferrer" : undefined}
              >
                {inner}
              </a>
            );
          })}
        </div>
      </section>

      <footer className="site-footer">
        <span>strictlyjayers.com</span>
        <a href={fantasyHubUrl} rel="noopener noreferrer">
          fantasy.strictlyjayers.com →
        </a>
      </footer>
    </main>
  );
}
