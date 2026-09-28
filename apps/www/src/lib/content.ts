/**
 * Apex portal copy — edit here before touching layout chrome.
 * Destination hrefs still come from getSiteConfig() / env.
 */

export type PortalEvent = {
  /** ISO date YYYY-MM-DD (UTC day). */
  date: string;
  label: string;
  where: string;
  /** Short sport / room chip (Football, Golf, Watch…). */
  sport?: string;
  href?: string;
  cta?: string;
};

export type CrewMember = {
  handle: string;
  name: string;
  blurb: string;
  /** Folk-style mark next to the name. */
  mark?: string;
  photo?: string;
  /** Omit from the grid when false — no hollow shells. */
  ready?: boolean;
};

export type DestinationItem = {
  index: string;
  kicker: string;
  title: string;
  body: string;
  action: string;
  actionPending: string;
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
    support: "Date, room, and a door into Discord or the hub.",
    marker: "CAL",
    empty: "Nothing dated yet — check Discord for the next hang.",
    items: [
      {
        date: "2026-08-16",
        label: "Watch party",
        where: "Discord voice + Watch",
        sport: "Watch",
        href: "/watch",
        cta: "Open Watch",
      },
      {
        date: "2026-09-01",
        label: "Football draft night",
        where: "Fantasy hub",
        sport: "Football",
        cta: "Open Fantasy",
      },
      {
        date: "2026-09-12",
        label: "Golf season kickoff",
        where: "Fantasy hub · Golf",
        sport: "Golf",
        cta: "Open Golf",
      },
      {
        date: "2026-09-18",
        label: "Thursday night watch",
        where: "Discord voice + Watch",
        sport: "Watch",
        href: "/watch",
        cta: "Open Watch",
      },
      {
        date: "2026-10-02",
        label: "Waiver-week hang",
        where: "Fantasy hub · Football",
        sport: "Football",
        cta: "Open Fantasy",
      },
    ] satisfies PortalEvent[],
  },
  destinations: {
    heading: "Where to go",
    support: "Four rooms first. The rest stay close — stubs stay small.",
    marker: "ROOMS",
    primary: ["fantasy", "fitness", "discord", "watch"] as const,
    secondary: ["ai", "people", "palworld"] as const,
    items: {
      fitness: {
        index: "02",
        kicker: "Train",
        title: "Fitness",
        body: "Log golf, tennis, pickleball, lifting, and endurance — local-first, installable, offline.",
        action: "Open Fitness",
        actionPending: "Open Fitness",
      },
      fantasy: {
        index: "01",
        kicker: "Leagues",
        title: "Fantasy",
        body: "Need standings, a waiver claim, or draft order? The hub has the live boards.",
        action: "Open the hub",
        actionPending: "Open the hub",
      },
      ai: {
        index: "05",
        kicker: "Signal",
        title: "AI News",
        body: "Catch up in five minutes — editor picks first, then the RSS firehose.",
        action: "Read AI News",
        actionPending: "Read AI News",
      },
      watch: {
        index: "04",
        kicker: "Queue",
        title: "Watch",
        body: "Tonight’s clip is already queued — hit play or drop the next one from Discord.",
        action: "Open Watch",
        actionPending: "Open Watch",
      },
      people: {
        index: "06",
        kicker: "Follow",
        title: "People",
        body: "Portraits and bios for Elon, Jensen, and the rest of the desk — one tap to their X.",
        action: "Open People",
        actionPending: "Open People",
      },
      discord: {
        index: "03",
        kicker: "Chat",
        title: "Discord",
        body: "Jump voice for the argument that does not belong on a league page.",
        action: "Join the server",
        actionPending: "Invite soon",
      },
      palworld: {
        index: "07",
        kicker: "Games",
        title: "Palworld",
        body: "Co-op when the world’s up — join details live on the room page, passwords stay in Discord.",
        action: "Open Palworld",
        actionPending: "Soon",
      },
    } satisfies Record<string, DestinationItem>,
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
        mark: "⛳",
        blurb: "Commissioner energy. Sets the draft music too loud.",
        ready: true,
      },
      {
        handle: "the-cap",
        name: "The Cap",
        mark: "🏈",
        blurb: "Always drafting RBs. Trophy-case regular.",
        ready: true,
      },
      {
        handle: "gridiron",
        name: "Gridiron",
        mark: "🎙️",
        blurb: "Late-round steals and worse takes in voice.",
        ready: true,
      },
    ] satisfies CrewMember[],
  },
  palworld: {
    heading: "Palworld",
    kicker: "Co-op world",
    support:
      "Join details live here so they are not buried in chat. IPs and passwords stay in Discord.",
    marker: "WORLD",
    statusLabel: "World status",
    status:
      "World status and the current password live in Discord — we do not post IPs here.",
    howToJoinHeading: "How to join",
    steps: [
      {
        title: "Join the crew Discord",
        body: "Voice and the games channel are where someone says the world is up.",
      },
      {
        title: "Ask for the current world",
        body: "A regular will drop the invite or password in-channel. Nothing public on this page.",
      },
      {
        title: "Jump in when it’s live",
        body: "Co-op when the world’s up — no public server-browser listing.",
      },
    ],
    discordCta: "Open Discord for join details",
    extraInfoCta: "More info",
    empty:
      "World is dark right now — ping Discord when you want a session.",
    ready: true,
  },
  footer: {
    left: "Strictly Jayers",
    fantasyLabel: "Fantasy hub",
    fitnessLabel: "Fitness",
  },
} as const;

export type DestinationId = keyof typeof portalCopy.destinations.items;

/** Upcoming events on/after `now` (UTC day), oldest first. */
export function upcomingPortalEvents(
  items: readonly PortalEvent[],
  now = new Date(),
  limit = 4,
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

export function formatPortalEventChip(isoDate: string): {
  month: string;
  day: string;
} {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return { month: "", day: isoDate };
  const date = new Date(Date.UTC(y, m - 1, d));
  return {
    month: date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
    day: String(d),
  };
}

export function crewInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** Cards that have a name, handle, and one-line bio — skip shells. */
export function readyCrewMembers(
  members: readonly CrewMember[] = portalCopy.crew.members,
): CrewMember[] {
  return members.filter(
    (member) =>
      member.ready !== false &&
      member.handle.trim() &&
      member.name.trim() &&
      member.blurb.trim(),
  );
}

export type PalworldRoom = (typeof portalCopy)["palworld"];

/** True when the Palworld room has public join copy (not a hollow stub). */
export function hasPalworldJoinContent(
  room: PalworldRoom = portalCopy.palworld,
  statusOverride?: string | null,
): boolean {
  if (statusOverride?.trim()) return true;
  if (!room.ready) return false;
  return Boolean(room.status.trim() || room.steps.length > 0);
}

export type PulseCell = {
  id: "event" | "watch" | "discord";
  kicker: string;
  title: string;
  detail: string | null;
  href: string;
  external?: boolean;
};

/**
 * Home pulse strip — next dated event, Watch feed facts, Discord CTA.
 * Watch count/title only when the playlist feed actually returned items.
 */
export function buildPortalPulse(opts: {
  nextEvent: PortalEvent | null;
  watchTitle: string | null;
  watchCount: number | null;
  discordInviteUrl: string | null;
}): PulseCell[] {
  const cells: PulseCell[] = [];
  if (opts.nextEvent) {
    const when = formatPortalEventDate(opts.nextEvent.date);
    cells.push({
      id: "event",
      kicker: "Next",
      title: opts.nextEvent.label,
      detail: opts.nextEvent.where
        ? `${when} · ${opts.nextEvent.where}`
        : when,
      href: opts.nextEvent.href ?? "/#events",
    });
  }
  if (opts.watchCount != null && opts.watchCount > 0) {
    cells.push({
      id: "watch",
      kicker: "Watch",
      title: opts.watchTitle ?? `${opts.watchCount} clips`,
      detail:
        opts.watchTitle != null
          ? `${opts.watchCount} clip${opts.watchCount === 1 ? "" : "s"} in the queue`
          : null,
      href: "/watch",
    });
  } else {
    cells.push({
      id: "watch",
      kicker: "Watch",
      title: "Shared playlist",
      detail: "Open the queue",
      href: "/watch",
    });
  }
  if (opts.discordInviteUrl) {
    cells.push({
      id: "discord",
      kicker: "Discord",
      title: "Jump voice",
      detail: "Drop a clip or hang",
      href: opts.discordInviteUrl,
      external: true,
    });
  }
  return cells;
}
