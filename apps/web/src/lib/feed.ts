/**
 * League feed UGC document (roadmap 7.6 steps 2–3).
 *
 * Pure helpers — disk I/O lives in feed-store.ts. Mirrors the auction room:
 * schema_version, revision optimistic concurrency, soft-delete for moderation.
 */

import { normalizeEmail } from "@/lib/hub-members";

export const FEED_SCHEMA_VERSION = 1 as const;
export const FEED_COMMENT_MAX_LENGTH = 500;
export const FEED_POLL_QUESTION_MAX = 200;
export const FEED_POLL_OPTION_MAX = 80;
export const FEED_POLL_OPTIONS_MIN = 2;
export const FEED_POLL_OPTIONS_MAX = 6;
/** Max comments (or poll creates) per author in the rolling window. */
export const FEED_RATE_LIMIT_COUNT = 10;
export const FEED_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export const FEED_REACTIONS = ["🔥", "😂", "👍", "👎", "💀", "🐐"] as const;
export type FeedReactionEmoji = (typeof FEED_REACTIONS)[number];

/** Free-standing league chat (not attached to a system event). */
export const FEED_LEAGUE_TARGET = "league";

export type FeedAuthor = {
  email: string;
  name: string;
  team_id: number | null;
};

export type FeedComment = {
  id: string;
  /** System event id, poll id, or FEED_LEAGUE_TARGET. */
  target_id: string;
  body: string;
  author_email: string;
  author_name: string;
  team_id: number | null;
  created_at: string;
  deleted_at: string | null;
};

export type FeedReaction = {
  target_id: string;
  emoji: FeedReactionEmoji;
  author_email: string;
  /** Stamped at write; older rows may omit — UI joins hub display names. */
  author_name?: string;
  created_at: string;
};

export type FeedPollOption = {
  id: string;
  label: string;
  voter_emails: string[];
};

export type FeedPoll = {
  id: string;
  question: string;
  options: FeedPollOption[];
  author_email: string;
  author_name: string;
  team_id: number | null;
  created_at: string;
  closes_at: string | null;
  deleted_at: string | null;
};

export type LeagueFeed = {
  schema_version: typeof FEED_SCHEMA_VERSION;
  league_id: string;
  season: number;
  updated_at: string;
  revision: number;
  comments: FeedComment[];
  reactions: FeedReaction[];
  polls: FeedPoll[];
  /**
   * Idempotency keys for outbound digest delivery (`${season}:${period}`).
   * Bumped revision when appended so CAS still applies.
   */
  delivered_digests?: string[];
};

function bump(feed: LeagueFeed, now: Date): LeagueFeed {
  return {
    ...feed,
    updated_at: now.toISOString(),
    revision: feed.revision + 1,
  };
}

export function emptyFeed(
  leagueId: string,
  season: number,
  now = new Date(),
): LeagueFeed {
  return {
    schema_version: FEED_SCHEMA_VERSION,
    league_id: leagueId,
    season,
    updated_at: now.toISOString(),
    revision: 0,
    comments: [],
    reactions: [],
    polls: [],
    delivered_digests: [],
  };
}

/** Record a successful outbound digest send (idempotent key). */
export function markDigestDelivered(
  feed: LeagueFeed,
  period: number,
  now = new Date(),
): LeagueFeed {
  const key = `${feed.season}:${period}`;
  const existing = feed.delivered_digests ?? [];
  if (existing.includes(key)) return feed;
  return bump(
    { ...feed, delivered_digests: [...existing, key] },
    now,
  );
}

export function wasDigestDelivered(feed: LeagueFeed, period: number): boolean {
  const key = `${feed.season}:${period}`;
  return (feed.delivered_digests ?? []).includes(key);
}

export function isAllowedReaction(
  emoji: string,
): emoji is FeedReactionEmoji {
  return (FEED_REACTIONS as readonly string[]).includes(emoji);
}

function newId(prefix: string, now: Date): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${now.getTime().toString(36)}_${rand}`;
}

function recentAuthorActions(
  feed: LeagueFeed,
  email: string,
  now: Date,
): number {
  const key = normalizeEmail(email);
  const cutoff = now.getTime() - FEED_RATE_LIMIT_WINDOW_MS;
  let count = 0;
  for (const c of feed.comments) {
    if (c.deleted_at) continue;
    if (normalizeEmail(c.author_email) !== key) continue;
    if (Date.parse(c.created_at) >= cutoff) count += 1;
  }
  for (const p of feed.polls) {
    if (p.deleted_at) continue;
    if (normalizeEmail(p.author_email) !== key) continue;
    if (Date.parse(p.created_at) >= cutoff) count += 1;
  }
  return count;
}

function assertRateLimit(feed: LeagueFeed, email: string, now: Date): void {
  if (recentAuthorActions(feed, email, now) >= FEED_RATE_LIMIT_COUNT) {
    throw new Error(
      `Rate limit: at most ${FEED_RATE_LIMIT_COUNT} posts per ${FEED_RATE_LIMIT_WINDOW_MS / 60000} minutes`,
    );
  }
}

export function addComment(
  feed: LeagueFeed,
  input: {
    target_id: string;
    body: string;
    author: FeedAuthor;
  },
  now = new Date(),
): LeagueFeed {
  const body = input.body.trim();
  if (!body) throw new Error("comment body is required");
  if (body.length > FEED_COMMENT_MAX_LENGTH) {
    throw new Error(`comment max length is ${FEED_COMMENT_MAX_LENGTH}`);
  }
  const target = input.target_id.trim();
  if (!target) throw new Error("target_id is required");
  const email = normalizeEmail(input.author.email);
  if (!email || !email.includes("@")) {
    throw new Error("author email is required");
  }
  assertRateLimit(feed, email, now);

  const comment: FeedComment = {
    id: newId("c", now),
    target_id: target,
    body,
    author_email: email,
    author_name: (input.author.name || email).trim().slice(0, 80),
    team_id:
      input.author.team_id != null && Number.isInteger(input.author.team_id)
        ? input.author.team_id
        : null,
    created_at: now.toISOString(),
    deleted_at: null,
  };
  return bump(
    { ...feed, comments: [comment, ...feed.comments] },
    now,
  );
}

export function deleteComment(
  feed: LeagueFeed,
  commentId: string,
  now = new Date(),
): LeagueFeed {
  const idx = feed.comments.findIndex((c) => c.id === commentId);
  if (idx < 0) throw new Error("comment not found");
  const current = feed.comments[idx];
  if (current.deleted_at) return feed;
  const comments = feed.comments.slice();
  comments[idx] = { ...current, deleted_at: now.toISOString() };
  return bump({ ...feed, comments }, now);
}

/**
 * Toggle a reaction for one author on a target. Same emoji again removes it;
 * a different emoji replaces the previous one (one reaction per author/target).
 */
export function toggleReaction(
  feed: LeagueFeed,
  input: {
    target_id: string;
    emoji: string;
    author_email: string;
    author_name?: string;
  },
  now = new Date(),
): LeagueFeed {
  const target = input.target_id.trim();
  if (!target) throw new Error("target_id is required");
  if (!isAllowedReaction(input.emoji)) {
    throw new Error(`unsupported reaction (allowed: ${FEED_REACTIONS.join(" ")})`);
  }
  const email = normalizeEmail(input.author_email);
  if (!email || !email.includes("@")) {
    throw new Error("author email is required");
  }
  const author_name = (input.author_name || email).trim().slice(0, 80);

  const existingIdx = feed.reactions.findIndex(
    (r) =>
      r.target_id === target && normalizeEmail(r.author_email) === email,
  );
  let reactions = feed.reactions.slice();
  if (existingIdx >= 0) {
    const existing = reactions[existingIdx];
    if (existing.emoji === input.emoji) {
      reactions.splice(existingIdx, 1);
    } else {
      reactions[existingIdx] = {
        target_id: target,
        emoji: input.emoji,
        author_email: email,
        author_name,
        created_at: now.toISOString(),
      };
    }
  } else {
    reactions = [
      {
        target_id: target,
        emoji: input.emoji,
        author_email: email,
        author_name,
        created_at: now.toISOString(),
      },
      ...reactions,
    ];
  }
  return bump({ ...feed, reactions }, now);
}

export function createPoll(
  feed: LeagueFeed,
  input: {
    question: string;
    options: string[];
    author: FeedAuthor;
    closes_at?: string | null;
  },
  now = new Date(),
): LeagueFeed {
  const question = input.question.trim();
  if (!question) throw new Error("poll question is required");
  if (question.length > FEED_POLL_QUESTION_MAX) {
    throw new Error(`poll question max length is ${FEED_POLL_QUESTION_MAX}`);
  }
  const labels = input.options.map((o) => o.trim()).filter(Boolean);
  if (
    labels.length < FEED_POLL_OPTIONS_MIN ||
    labels.length > FEED_POLL_OPTIONS_MAX
  ) {
    throw new Error(
      `polls need ${FEED_POLL_OPTIONS_MIN}–${FEED_POLL_OPTIONS_MAX} options`,
    );
  }
  for (const label of labels) {
    if (label.length > FEED_POLL_OPTION_MAX) {
      throw new Error(`poll option max length is ${FEED_POLL_OPTION_MAX}`);
    }
  }
  const email = normalizeEmail(input.author.email);
  if (!email || !email.includes("@")) {
    throw new Error("author email is required");
  }
  assertRateLimit(feed, email, now);

  const poll: FeedPoll = {
    id: newId("p", now),
    question,
    options: labels.map((label, i) => ({
      id: `opt_${i}`,
      label,
      voter_emails: [],
    })),
    author_email: email,
    author_name: (input.author.name || email).trim().slice(0, 80),
    team_id:
      input.author.team_id != null && Number.isInteger(input.author.team_id)
        ? input.author.team_id
        : null,
    created_at: now.toISOString(),
    closes_at: input.closes_at ?? null,
    deleted_at: null,
  };
  return bump({ ...feed, polls: [poll, ...feed.polls] }, now);
}

export function votePoll(
  feed: LeagueFeed,
  input: {
    poll_id: string;
    option_id: string;
    voter_email: string;
  },
  now = new Date(),
): LeagueFeed {
  const email = normalizeEmail(input.voter_email);
  if (!email || !email.includes("@")) {
    throw new Error("voter email is required");
  }
  const pIdx = feed.polls.findIndex((p) => p.id === input.poll_id);
  if (pIdx < 0) throw new Error("poll not found");
  const poll = feed.polls[pIdx];
  if (poll.deleted_at) throw new Error("poll was deleted");
  if (poll.closes_at && Date.parse(poll.closes_at) <= now.getTime()) {
    throw new Error("poll is closed");
  }
  const oIdx = poll.options.findIndex((o) => o.id === input.option_id);
  if (oIdx < 0) throw new Error("poll option not found");

  const options = poll.options.map((opt) => ({
    ...opt,
    voter_emails: opt.voter_emails.filter(
      (v) => normalizeEmail(v) !== email,
    ),
  }));
  options[oIdx] = {
    ...options[oIdx],
    voter_emails: [...options[oIdx].voter_emails, email],
  };
  const polls = feed.polls.slice();
  polls[pIdx] = { ...poll, options };
  return bump({ ...feed, polls }, now);
}

export function deletePoll(
  feed: LeagueFeed,
  pollId: string,
  now = new Date(),
): LeagueFeed {
  const idx = feed.polls.findIndex((p) => p.id === pollId);
  if (idx < 0) throw new Error("poll not found");
  const current = feed.polls[idx];
  if (current.deleted_at) return feed;
  const polls = feed.polls.slice();
  polls[idx] = { ...current, deleted_at: now.toISOString() };
  return bump({ ...feed, polls }, now);
}

export type ReactionSummaryRow = {
  emoji: FeedReactionEmoji;
  count: number;
  mine: boolean;
  /** Display names of who reacted (newest first). */
  names: string[];
};

function reactionDisplayName(
  reaction: FeedReaction,
  nameByEmail?: Record<string, string> | null,
): string {
  const email = normalizeEmail(reaction.author_email);
  const live = nameByEmail?.[email]?.trim();
  if (live) return live;
  const stamped = reaction.author_name?.trim();
  if (stamped) return stamped;
  return email.includes("@") ? email.split("@")[0]! : email || "Member";
}

export function reactionSummary(
  reactions: FeedReaction[],
  targetId: string,
  nameByEmail?: Record<string, string> | null,
): ReactionSummaryRow[] {
  return reactionSummaryForViewer(reactions, targetId, null, nameByEmail);
}

export function reactionSummaryForViewer(
  reactions: FeedReaction[],
  targetId: string,
  viewerEmail: string | null | undefined,
  nameByEmail?: Record<string, string> | null,
): ReactionSummaryRow[] {
  const key = viewerEmail ? normalizeEmail(viewerEmail) : null;
  const counts = new Map<FeedReactionEmoji, number>();
  const mine = new Set<FeedReactionEmoji>();
  const names = new Map<FeedReactionEmoji, string[]>();
  for (const r of reactions) {
    if (r.target_id !== targetId) continue;
    counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
    if (key && normalizeEmail(r.author_email) === key) mine.add(r.emoji);
    const list = names.get(r.emoji) ?? [];
    list.push(reactionDisplayName(r, nameByEmail));
    names.set(r.emoji, list);
  }
  return FEED_REACTIONS.filter((emoji) => counts.has(emoji)).map((emoji) => ({
    emoji,
    count: counts.get(emoji) ?? 0,
    mine: mine.has(emoji),
    names: names.get(emoji) ?? [],
  }));
}
