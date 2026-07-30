/**
 * Apex portal copy — edit here before touching layout chrome.
 * Destination hrefs still come from getSiteConfig() / env.
 */
export const portalCopy = {
  metaDescription:
    "Strictly Jayers — the crew's front door for Discord, games, and fantasy leagues.",
  hero: {
    headline: "Same crew. Different rooms.",
    support:
      "This is the front door — chat, co-op nights, and a straight path into the fantasy hub when draft season hits.",
    ctaFantasy: "Open fantasy hub",
    ctaDiscord: "Join Discord",
    ctaExplore: "See where to go",
  },
  destinations: {
    heading: "Where to go",
    support: "Three rooms. Pick the one you need.",
    items: {
      fantasy: {
        kicker: "Fantasy",
        title: "Leagues & tools",
        body: "Football, baseball, and golf — standings, drafts, waivers, and the seasons that built this group.",
        action: "fantasy.strictlyjayers.com",
        actionPending: "fantasy.strictlyjayers.com",
      },
      discord: {
        kicker: "Chat",
        title: "Discord",
        body: "Pick talk, server nights, and the chatter that never belongs on a league page.",
        action: "Join the server",
        actionPending: "Invite coming soon",
      },
      palworld: {
        kicker: "Games",
        title: "Palworld",
        body: "Co-op when the server's up — join info lives here so it isn't buried in chat history.",
        action: "Server info",
        actionPending: "Details coming soon",
      },
    },
  },
  footer: {
    left: "Strictly Jayers",
    fantasyLabel: "Fantasy hub",
  },
} as const;
