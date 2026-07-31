/**
 * Apex portal copy — edit here before touching layout chrome.
 * Destination hrefs still come from getSiteConfig() / env.
 */
export const portalCopy = {
  metaDescription:
    "Strictly Jayers — the crew's front door for Discord, games, AI news, and fantasy leagues.",
  hero: {
    kicker: "The front door",
    headline: "Same crew. Different rooms.",
    support:
      "This is the front door — chat, co-op nights, AI headlines, and a straight path into the fantasy hub when draft season hits.",
    ctaFantasy: "Open fantasy hub",
    ctaDiscord: "Join Discord",
    ctaExplore: "See where to go",
  },
  destinations: {
    heading: "Where to go",
    support: "Four rooms. Pick the one you need.",
    marker: "01 — 04",
    items: {
      fantasy: {
        index: "01",
        kicker: "Fantasy",
        title: "Leagues & tools",
        body: "Football, baseball, and golf — standings, drafts, waivers, and the seasons that built this group.",
        action: "Open the hub",
        actionPending: "Open the hub",
      },
      ai: {
        index: "02",
        kicker: "Signal",
        title: "AI News",
        body: "Headlines from OpenAI, Anthropic, Cursor, and Google — plus live timelines when you want the firehose.",
        action: "Read AI News",
        actionPending: "Read AI News",
      },
      discord: {
        index: "03",
        kicker: "Chat",
        title: "Discord",
        body: "Pick talk, server nights, and the chatter that never belongs on a league page.",
        action: "Join the server",
        actionPending: "Invite soon",
      },
      palworld: {
        index: "04",
        kicker: "Games",
        title: "Palworld",
        body: "Co-op when the server's up — join info lives here so it isn't buried in chat history.",
        action: "Server info",
        actionPending: "Details soon",
      },
    },
  },
  footer: {
    left: "Strictly Jayers",
    fantasyLabel: "Fantasy hub",
  },
} as const;
