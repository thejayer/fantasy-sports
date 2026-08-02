/**
 * Public member profile helpers (roadmap 7.12 follow-on).
 * Pure — disk I/O stays in the page / feed-store.
 */

import { normalizeEmail, type HubMemberTeamLink } from "@/lib/hub-members";
import type { LeagueFeed } from "@/lib/feed";
import type { FranchiseCareer } from "@/lib/history";

export type ProfileTrophyChip = {
  leagueId: string;
  leagueName: string;
  teamId: number;
  /** Short badge, e.g. "2× #1". */
  label: string;
  /** Supporting line under the badge. */
  detail: string;
  /** History trophy case for that league. */
  href: string;
};

export type ProfileCareerInput = {
  link: HubMemberTeamLink;
  career: FranchiseCareer | null;
  /** Season used in trophy-case deep links (usually latest on disk). */
  season: number;
  leagueName: string;
};

/** Regular-season #1 chips that deep-link into History → Trophies. */
export function profileTrophyChips(
  careers: ProfileCareerInput[],
): ProfileTrophyChip[] {
  const chips: ProfileTrophyChip[] = [];
  for (const row of careers) {
    const n = row.career?.totals?.championships ?? 0;
    if (n <= 0) continue;
    const leagueName =
      row.leagueName.trim() ||
      row.link.league_name?.trim() ||
      row.link.league_id;
    chips.push({
      leagueId: row.link.league_id,
      leagueName,
      teamId: row.link.team_id,
      label: `${n}× #1`,
      detail: leagueName,
      href: `/leagues/${row.link.league_id}?season=${row.season}&tab=history&view=trophies`,
    });
  }
  return chips.sort((a, b) => a.leagueName.localeCompare(b.leagueName));
}

export type ProfileActivityKind = "comment" | "poll" | "reaction";

export type ProfileActivityItem = {
  kind: ProfileActivityKind;
  id: string;
  leagueId: string;
  season: number;
  leagueName: string;
  createdAt: string;
  title: string;
  body?: string;
  href: string;
};

export type ProfileFeedInput = {
  feed: LeagueFeed;
  leagueName: string;
};

const DEFAULT_ACTIVITY_LIMIT = 8;

/**
 * Recent UGC by one member across league feeds (newest first).
 * Soft-deleted comments/polls are skipped; reactions stay.
 */
export function collectMemberFeedActivity(
  feeds: ProfileFeedInput[],
  email: string,
  opts?: { limit?: number },
): ProfileActivityItem[] {
  const key = normalizeEmail(email);
  if (!key) return [];
  const limit = opts?.limit ?? DEFAULT_ACTIVITY_LIMIT;
  const items: ProfileActivityItem[] = [];

  for (const { feed, leagueName } of feeds) {
    const name = leagueName.trim() || feed.league_id;
    const talkHref = `/leagues/${feed.league_id}?season=${feed.season}&tab=activity&view=talk`;
    const allHref = `/leagues/${feed.league_id}?season=${feed.season}&tab=activity&view=all`;

    for (const comment of feed.comments) {
      if (comment.deleted_at) continue;
      if (normalizeEmail(comment.author_email) !== key) continue;
      const body = comment.body.trim();
      items.push({
        kind: "comment",
        id: `comment:${feed.league_id}:${comment.id}`,
        leagueId: feed.league_id,
        season: feed.season,
        leagueName: name,
        createdAt: comment.created_at,
        title: "Comment",
        body: body.slice(0, 160),
        href:
          comment.target_id && comment.target_id !== "league"
            ? allHref
            : talkHref,
      });
    }

    for (const poll of feed.polls) {
      if (poll.deleted_at) continue;
      if (normalizeEmail(poll.author_email) !== key) continue;
      items.push({
        kind: "poll",
        id: `poll:${feed.league_id}:${poll.id}`,
        leagueId: feed.league_id,
        season: feed.season,
        leagueName: name,
        createdAt: poll.created_at,
        title: "Poll",
        body: poll.question.trim().slice(0, 160),
        href: talkHref,
      });
    }

    for (const reaction of feed.reactions) {
      if (normalizeEmail(reaction.author_email) !== key) continue;
      items.push({
        kind: "reaction",
        id: `reaction:${feed.league_id}:${reaction.target_id}:${reaction.emoji}:${reaction.created_at}`,
        leagueId: feed.league_id,
        season: feed.season,
        leagueName: name,
        createdAt: reaction.created_at,
        title: `Reacted ${reaction.emoji}`,
        href: allHref,
      });
    }
  }

  return items
    .sort((a, b) => {
      const ta = Date.parse(a.createdAt) || 0;
      const tb = Date.parse(b.createdAt) || 0;
      return tb - ta;
    })
    .slice(0, limit);
}

export function formatActivityWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
