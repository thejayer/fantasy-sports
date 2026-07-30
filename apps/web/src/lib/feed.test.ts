import { describe, expect, it } from "vitest";

import {
  FEED_LEAGUE_TARGET,
  addComment,
  createPoll,
  deleteComment,
  emptyFeed,
  markDigestDelivered,
  toggleReaction,
  votePoll,
  wasDigestDelivered,
} from "@/lib/feed";

describe("league feed UGC (roadmap 7.6)", () => {
  const author = {
    email: "jay@example.com",
    name: "Jay",
    team_id: 1,
  };

  it("adds comments with revision bumps and soft-deletes", () => {
    const t0 = new Date("2026-09-01T12:00:00Z");
    let feed = emptyFeed("football-main", 2026, t0);
    expect(feed.revision).toBe(0);
    feed = addComment(
      feed,
      { target_id: FEED_LEAGUE_TARGET, body: "nice pick", author },
      new Date(t0.getTime() + 1000),
    );
    expect(feed.revision).toBe(1);
    expect(feed.comments).toHaveLength(1);
    expect(feed.comments[0].body).toBe("nice pick");
    feed = deleteComment(
      feed,
      feed.comments[0].id,
      new Date(t0.getTime() + 2000),
    );
    expect(feed.comments[0].deleted_at).toBeTruthy();
    expect(feed.revision).toBe(2);
  });

  it("rejects empty and oversized comments", () => {
    const feed = emptyFeed("football-main", 2026);
    expect(() =>
      addComment(feed, { target_id: "league", body: "   ", author }),
    ).toThrow(/required/);
    expect(() =>
      addComment(feed, {
        target_id: "league",
        body: "x".repeat(501),
        author,
      }),
    ).toThrow(/max length/);
  });

  it("toggles reactions per author/target", () => {
    const t0 = new Date("2026-09-01T12:00:00Z");
    let feed = emptyFeed("football-main", 2026, t0);
    feed = addComment(
      feed,
      { target_id: "league", body: "hi", author },
      new Date(t0.getTime() + 1),
    );
    const target = feed.comments[0].id;
    feed = toggleReaction(
      feed,
      { target_id: target, emoji: "🔥", author_email: author.email },
      new Date(t0.getTime() + 2),
    );
    expect(feed.reactions).toHaveLength(1);
    feed = toggleReaction(
      feed,
      { target_id: target, emoji: "🔥", author_email: author.email },
      new Date(t0.getTime() + 3),
    );
    expect(feed.reactions).toHaveLength(0);
  });

  it("creates polls and records one vote per email", () => {
    const t0 = new Date("2026-09-01T12:00:00Z");
    let feed = emptyFeed("football-main", 2026, t0);
    feed = createPoll(
      feed,
      {
        question: "Draft Thursday?",
        options: ["Yes", "No", "Maybe"],
        author,
      },
      new Date(t0.getTime() + 1),
    );
    const poll = feed.polls[0];
    feed = votePoll(
      feed,
      {
        poll_id: poll.id,
        option_id: "opt_0",
        voter_email: "a@example.com",
      },
      new Date(t0.getTime() + 2),
    );
    feed = votePoll(
      feed,
      {
        poll_id: poll.id,
        option_id: "opt_1",
        voter_email: "a@example.com",
      },
      new Date(t0.getTime() + 3),
    );
    expect(feed.polls[0].options[0].voter_emails).toHaveLength(0);
    expect(feed.polls[0].options[1].voter_emails).toEqual(["a@example.com"]);
  });

  it("rate-limits rapid posts from one author", () => {
    const t0 = new Date("2026-09-01T12:00:00Z");
    let feed = emptyFeed("football-main", 2026, t0);
    for (let i = 0; i < 10; i++) {
      feed = addComment(
        feed,
        { target_id: "league", body: `msg ${i}`, author },
        new Date(t0.getTime() + i),
      );
    }
    expect(() =>
      addComment(
        feed,
        { target_id: "league", body: "one too many", author },
        new Date(t0.getTime() + 11),
      ),
    ).toThrow(/Rate limit/);
  });

  it("tracks digest delivery idempotency keys", () => {
    let feed = emptyFeed("football-main", 2026);
    expect(wasDigestDelivered(feed, 3)).toBe(false);
    feed = markDigestDelivered(feed, 3);
    expect(wasDigestDelivered(feed, 3)).toBe(true);
    const rev = feed.revision;
    feed = markDigestDelivered(feed, 3);
    expect(feed.revision).toBe(rev);
  });
});
