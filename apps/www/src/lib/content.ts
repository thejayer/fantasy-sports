/**
 * Apex portal copy — edit here before touching layout chrome.
 * Destination hrefs still come from getSiteConfig() / env.
 */

export type PortalEvent = {
  /** ISO date YYYY-MM-DD (UTC day). */
  date: string;
  label: string;
  where: string;
  href?: string;
};

export type CrewMember = {
  handle: string;
  name: string;
  blurb: string;
};

export const portalCopy = {
  metaDescription:
    "Strictly Jayers — the crew's front door for Discord, games, watch party, AI news, people to follow, fantasy leagues, and the training log.",
  hero: {
    kicker: "The front door",
    headline: "Same crew. Different rooms.",
    support:
      "Chat is warm, Watch is queued, people to follow are listed, AI headlines are skimmed, the training log is on Fitness, and the fantasy hub is one click when draft night hits.",
    ctaFantasy: "Open fantasy hub",
    ctaDiscord: "Join Discord",
    ctaExplore: "See where to go",
  },
  events: {
    heading: "Coming up",
    support: "The next reasons to open Discord or the hub.",
    marker: "CAL",
    empty: "Nothing dated yet — check Discord for the next hang.",
    items: [
      {
        date: "2026-08-16",
        label: "Watch party",
        where: "Discord voice + Watch",
        href: "/watch",
      },
      {
        date: "2026-09-01",
        label: "Football draft night",
        where: "Fantasy hub",
      },
      {
        date: "2026-09-12",
        label: "Golf season kickoff",
        where: "Fantasy hub · Golf",
      },
    ] satisfies PortalEvent[],
  },
  destinations: {
    heading: "Where to go",
    support: "Seven rooms. Pick the one you need right now.",
    marker: "01 — 07",
    items: {
      fitness: {
        index: "07",
        kicker: "Train",
        title: "Fitness",
        body: "Log golf, tennis, pickleball, lifting, and endurance — local-first, installable, offline.",
        action: "Open Fitness",
        actionPending: "Open Fitness",
      },
      fantasy: {
        index: "01",
        kicker: "Fantasy",
        title: "Leagues & tools",
        body: "Need standings, a waiver claim, or draft order? The hub has the live boards.",
        action: "Open the hub",
        actionPending: "Open the hub",
      },
      ai: {
        index: "02",
        kicker: "Signal",
        title: "AI News",
        body: "Catch up in five minutes — editor picks first, then the RSS firehose.",
        action: "Read AI News",
        actionPending: "Read AI News",
      },
      watch: {
        index: "03",
        kicker: "Queue",
        title: "Watch",
        body: "Tonight’s clip is already queued — hit play or drop the next one from Discord.",
        action: "Open Watch",
        actionPending: "Open Watch",
      },
      people: {
        index: "04",
        kicker: "Follow",
        title: "People",
        body: "Portraits and bios for Elon, Jensen, and the rest of the desk — one tap to their X.",
        action: "Open People",
        actionPending: "Open People",
      },
      discord: {
        index: "05",
        kicker: "Chat",
        title: "Discord",
        body: "Jump voice for the argument that does not belong on a league page.",
        action: "Join the server",
        actionPending: "Invite soon",
      },
      palworld: {
        index: "06",
        kicker: "Games",
        title: "Palworld",
        body: "Co-op when the world’s up — join details land here so they are not buried in chat.",
        action: "Server info",
        actionPending: "Details soon",
      },
    },
  },
  crew: {
    heading: "Meet the crew",
    support:
      "Public hub profiles — usernames and bios live under fantasy.strictlyjayers.com/u.",
    marker: "CREW",
    empty: "Profiles show up here once members set a username in the hub.",
    /** Handles must match hub /u/{handle} slugs once members claim them. */
    members: [
      {
        handle: "jay",
        name: "Jay",
        blurb: "Commissioner energy. Sets the draft music too loud.",
      },
      {
        handle: "the-cap",
        name: "The Cap",
        blurb: "Always drafting RBs. Trophy-case regular.",
      },
      {
        handle: "gridiron",
        name: "Gridiron",
        blurb: "Late-round steals and worse takes in voice.",
      },
    ] satisfies CrewMember[],
  },
  footer: {
    left: "Strictly Jayers",
    fantasyLabel: "Fantasy hub",
    fitnessLabel: "Fitness",
  },
} as const;

/** Upcoming events on/after `now` (UTC day), oldest first. */
export function upcomingPortalEvents(
  items: readonly PortalEvent[],
  now = new Date(),
  limit = 3,
): PortalEvent[] {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return items
    .filter((item) => {
      const [y, m, d] = item.date.split("-").map(Number);
      if (!y || !m || !d) return false;
      return Date.UTC(y, m - 1, d) >= today;
    })
    .slice(0, limit);
}

export function formatPortalEventDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
