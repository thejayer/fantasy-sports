"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import type { ActivityView } from "@/lib/activity";
import {
  FEED_LEAGUE_TARGET,
  FEED_REACTIONS,
  reactionSummaryForViewer,
  type LeagueFeed,
} from "@/lib/feed";
import type { SystemFeedEvent } from "@/lib/feed-events";
import {
  inFeedDateRange,
  isoCreatedAtMs,
  parseFeedDayEnd,
  parseFeedDayStart,
  parseFeedSortDir,
  sortByFeedKey,
  type FeedSortDir,
} from "@/lib/feed-query";

type FeedPanelProps = {
  leagueId: string;
  season: number;
  view: ActivityView;
  events: SystemFeedEvent[];
  initialFeed: LeagueFeed;
  viewerEmail: string | null;
  /** Live username map from hub_members (email → display_name). */
  nameByEmail?: Record<string, string>;
  canPost: boolean;
  canModerate: boolean;
  digestPeriod: number | null;
};

function liveName(
  email: string,
  stamped: string | undefined,
  nameByEmail?: Record<string, string>,
): string {
  const key = email.trim().toLowerCase();
  return (
    nameByEmail?.[key]?.trim() ||
    stamped?.trim() ||
    (key.includes("@") ? key.split("@")[0]! : key) ||
    "Member"
  );
}

async function fetchFeed(
  leagueId: string,
  season: number,
): Promise<LeagueFeed> {
  const res = await fetch(
    `/api/leagues/${leagueId}/feed?season=${season}`,
    { cache: "no-store" },
  );
  const payload = (await res.json()) as { feed?: LeagueFeed; error?: string };
  if (!res.ok) throw new Error(payload.error || "failed to load feed");
  if (!payload.feed) throw new Error("feed missing from response");
  return payload.feed;
}

export function FeedPanel({
  leagueId,
  season,
  view,
  events,
  initialFeed,
  viewerEmail,
  nameByEmail,
  canPost,
  canModerate,
  digestPeriod,
}: FeedPanelProps) {
  const searchParams = useSearchParams();
  const dir = parseFeedSortDir(searchParams.get("dir"));
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const fromMs = parseFeedDayStart(fromParam);
  const toMs = parseFeedDayEnd(toParam);

  const [feed, setFeed] = useState<LeagueFeed>(initialFeed);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [composer, setComposer] = useState("");
  const [replyTo, setReplyTo] = useState<string>(FEED_LEAGUE_TARGET);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState("Yes\nNo");
  const [showPoll, setShowPoll] = useState(false);

  const feedHref = useCallback(
    (patch: {
      view?: ActivityView;
      dir?: FeedSortDir;
      from?: string | null;
      to?: string | null;
    }) => {
      const params = new URLSearchParams();
      params.set("season", String(season));
      params.set("tab", "activity");
      params.set("view", patch.view ?? view);
      const nextDir = patch.dir ?? dir;
      if (nextDir === "asc") params.set("dir", "asc");
      const nextFrom = patch.from === undefined ? fromParam : patch.from;
      const nextTo = patch.to === undefined ? toParam : patch.to;
      if (nextFrom) params.set("from", nextFrom);
      if (nextTo) params.set("to", nextTo);
      return `/leagues/${leagueId}?${params.toString()}`;
    },
    [dir, fromParam, leagueId, season, toParam, view],
  );

  const refresh = useCallback(async () => {
    try {
      const next = await fetchFeed(leagueId, season);
      setFeed(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load feed");
    }
  }, [leagueId, season]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          season,
          revision: feed.revision,
          ...body,
        }),
      });
      const payload = (await res.json()) as {
        feed?: LeagueFeed;
        error?: string;
      };
      if (payload.feed) setFeed(payload.feed);
      if (!res.ok) throw new Error(payload.error || `request failed (${res.status})`);
      if (body.action === "comment") {
        setComposer("");
        setReplyTo(FEED_LEAGUE_TARGET);
      }
      if (body.action === "create_poll") {
        setPollQuestion("");
        setShowPoll(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "action failed");
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const commentsByTarget = useMemo(() => {
    const map = new Map<string, LeagueFeed["comments"]>();
    for (const c of feed.comments) {
      if (c.deleted_at) continue;
      if (!inFeedDateRange(isoCreatedAtMs(c.created_at), fromMs, toMs)) continue;
      const list = map.get(c.target_id) ?? [];
      list.push(c);
      map.set(c.target_id, list);
    }
    for (const [key, list] of map) {
      map.set(
        key,
        sortByFeedKey(
          list,
          (c) => isoCreatedAtMs(c.created_at),
          (c) => c.id,
          dir,
        ),
      );
    }
    return map;
  }, [dir, feed, fromMs, toMs]);

  const livePolls = useMemo(
    () =>
      sortByFeedKey(
        feed.polls.filter(
          (p) =>
            !p.deleted_at &&
            inFeedDateRange(isoCreatedAtMs(p.created_at), fromMs, toMs),
        ),
        (p) => isoCreatedAtMs(p.created_at),
        (p) => p.id,
        dir,
      ),
    [dir, feed.polls, fromMs, toMs],
  );
  const leagueChat = commentsByTarget.get(FEED_LEAGUE_TARGET) ?? [];

  const filteredEvents = useMemo(() => {
    let list: SystemFeedEvent[] = [];
    if (view === "talk") list = [];
    else if (view === "all") list = events;
    else if (view === "trades") list = events.filter((e) => e.kind === "trade");
    else if (view === "waivers") {
      list = events.filter((e) => e.kind === "waiver");
    } else if (view === "results") {
      list = events.filter((e) => e.kind === "result" || e.kind === "digest");
    } else if (view === "draft") {
      list = events.filter((e) => e.kind === "draft");
    } else list = events;

    list = list.filter((e) => inFeedDateRange(e.sortKey, fromMs, toMs));
    return sortByFeedKey(
      list,
      (e) => e.sortKey,
      (e) => e.id,
      dir,
    );
  }, [dir, events, fromMs, toMs, view]);

  const views: Array<{ id: ActivityView; label: string }> = [
    { id: "all", label: "All" },
    { id: "trades", label: "Trades" },
    { id: "waivers", label: "Adds / drops" },
    { id: "results", label: "Results" },
    { id: "draft", label: "Draft" },
    { id: "talk", label: "Talk" },
  ];

  const emptySystem =
    view !== "talk" && !filteredEvents.length && !livePolls.length;

  return (
    <div className="feed-panel">
      <p className="lede feed-lede">
        Transactions, results, and digests — plus comments, reactions, and
        polls from the league.
      </p>

      <div className="tabs" style={{ marginTop: "0.5rem" }}>
        {views.map((item) => (
          <Link
            key={item.id}
            href={feedHref({ view: item.id })}
            className={`tab${view === item.id ? " active" : ""}`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <form className="feed-toolbar" method="get" action={`/leagues/${leagueId}`}>
        <input type="hidden" name="season" value={season} />
        <input type="hidden" name="tab" value="activity" />
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="dir" value={dir} />
        <div className="feed-sort" role="group" aria-label="Sort order">
          <Link
            href={feedHref({ dir: "desc" })}
            className={`tab${dir === "desc" ? " active" : ""}`}
          >
            Newest first
          </Link>
          <Link
            href={feedHref({ dir: "asc" })}
            className={`tab${dir === "asc" ? " active" : ""}`}
          >
            Oldest first
          </Link>
        </div>
        <label className="feed-date-field">
          <span className="league-meta">From</span>
          <input
            type="date"
            name="from"
            aria-label="Feed from date"
            defaultValue={fromParam ?? ""}
          />
        </label>
        <label className="feed-date-field">
          <span className="league-meta">To</span>
          <input
            type="date"
            name="to"
            aria-label="Feed to date"
            defaultValue={toParam ?? ""}
          />
        </label>
        <button type="submit" className="button secondary">
          Apply dates
        </button>
        {fromParam || toParam ? (
          <Link
            className="button secondary"
            href={feedHref({ from: null, to: null })}
          >
            Clear dates
          </Link>
        ) : null}
      </form>

      {error ? (
        <p className="muted" role="alert" style={{ marginTop: "0.5rem" }}>
          {error}
        </p>
      ) : null}

      {canPost ? (
        <div className="panel feed-composer">
          <label className="feed-field">
            <span className="league-meta">
              {replyTo === FEED_LEAGUE_TARGET
                ? "Post to the league"
                : "Reply to event"}
            </span>
            <textarea
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Keep it short — this is a friend league, not Twitter."
            />
          </label>
          <div className="feed-composer-actions">
            <button
              type="button"
              className="button"
              disabled={busy || !composer.trim()}
              onClick={() =>
                void post({
                  action: "comment",
                  target_id: replyTo,
                  body: composer,
                })
              }
            >
              Post
            </button>
            {replyTo !== FEED_LEAGUE_TARGET ? (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setReplyTo(FEED_LEAGUE_TARGET)}
              >
                Cancel reply
              </button>
            ) : null}
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setShowPoll((v) => !v)}
            >
              {showPoll ? "Hide poll" : "New poll"}
            </button>
          </div>
          {showPoll ? (
            <div className="feed-poll-composer">
              <label className="feed-field">
                <span className="league-meta">Question</span>
                <input
                  value={pollQuestion}
                  onChange={(e) => setPollQuestion(e.target.value)}
                  maxLength={200}
                />
              </label>
              <label className="feed-field">
                <span className="league-meta">Options (one per line)</span>
                <textarea
                  value={pollOptions}
                  onChange={(e) => setPollOptions(e.target.value)}
                  rows={4}
                />
              </label>
              <button
                type="button"
                className="button"
                disabled={busy || !pollQuestion.trim()}
                onClick={() =>
                  void post({
                    action: "create_poll",
                    question: pollQuestion,
                    options: pollOptions
                      .split("\n")
                      .map((l) => l.trim())
                      .filter(Boolean),
                  })
                }
              >
                Create poll
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="muted feed-gate">
          Link a franchise in /admin to post, react, or create polls. Set a
          username under <Link href="/settings">Profile</Link>.
        </p>
      )}

      {digestPeriod != null && canModerate ? (
        <p className="league-meta" style={{ marginTop: "0.75rem" }}>
          Week {digestPeriod} digest is in the feed.
          {feed.delivered_digests?.includes(`${season}:${digestPeriod}`) ? (
            <> Discord delivery recorded.</>
          ) : (
            <>
              {" "}
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void post({ action: "deliver_digest", period: digestPeriod })
                }
              >
                Send to Discord
              </button>
            </>
          )}
        </p>
      ) : null}

      {view === "talk" || view === "all" ? (
        <section className="feed-stream">
          {view === "talk" ? (
            <h3 className="feed-stream-title">League talk</h3>
          ) : null}
          {livePolls.map((poll) => (
            <article key={poll.id} className="panel feed-item">
              <header className="feed-item-head">
                <span className="league-meta">
                  Poll ·{" "}
                  {liveName(poll.author_email, poll.author_name, nameByEmail)}
                </span>
                {canModerate ? (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      void post({ action: "delete_poll", poll_id: poll.id })
                    }
                  >
                    Delete
                  </button>
                ) : null}
              </header>
              <h3 className="feed-item-title">{poll.question}</h3>
              <ul className="feed-poll-options">
                {poll.options.map((opt) => {
                  const total = poll.options.reduce(
                    (n, o) => n + o.voter_emails.length,
                    0,
                  );
                  const mine =
                    viewerEmail != null &&
                    opt.voter_emails.some(
                      (e) => e.toLowerCase() === viewerEmail.toLowerCase(),
                    );
                  return (
                    <li key={opt.id}>
                      <button
                        type="button"
                        className={`button${mine ? "" : " secondary"}`}
                        disabled={busy || !canPost}
                        onClick={() =>
                          void post({
                            action: "vote_poll",
                            poll_id: poll.id,
                            option_id: opt.id,
                          })
                        }
                      >
                        {opt.label} · {opt.voter_emails.length}
                        {total
                          ? ` (${Math.round((opt.voter_emails.length / total) * 100)}%)`
                          : ""}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <ReactionBar
                targetId={poll.id}
                feed={feed}
                viewerEmail={viewerEmail}
                nameByEmail={nameByEmail}
                canPost={canPost}
                busy={busy}
                onReact={(emoji) =>
                  void post({
                    action: "react",
                    target_id: poll.id,
                    emoji,
                  })
                }
              />
            </article>
          ))}
          {leagueChat.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              feed={feed}
              viewerEmail={viewerEmail}
              nameByEmail={nameByEmail}
              canPost={canPost}
              canModerate={canModerate}
              busy={busy}
              onReact={(emoji) =>
                void post({
                  action: "react",
                  target_id: c.id,
                  emoji,
                })
              }
              onDelete={() =>
                void post({ action: "delete_comment", comment_id: c.id })
              }
            />
          ))}
          {view === "talk" && !livePolls.length && !leagueChat.length ? (
            <EmptyState title="No talk yet">
              Be the first to post a note or open a poll for draft night.
            </EmptyState>
          ) : null}
        </section>
      ) : null}

      {view !== "talk" ? (
        <section className="feed-stream">
          {emptySystem ? (
            <EmptyState title="Nothing in this filter">
              Try All, or switch to Talk for member posts.
            </EmptyState>
          ) : (
            filteredEvents.map((event) => {
              const replies = commentsByTarget.get(event.id) ?? [];
              return (
                <article key={event.id} className="panel feed-item">
                  <header className="feed-item-head">
                    <span className="league-meta">
                      {event.dateLabel} · {event.kind}
                    </span>
                  </header>
                  <h3 className="feed-item-title">
                    {event.href ? (
                      <Link href={event.href}>{event.title}</Link>
                    ) : (
                      event.title
                    )}
                  </h3>
                  <pre className="feed-item-body">{event.body}</pre>
                  <ReactionBar
                    targetId={event.id}
                    feed={feed}
                    viewerEmail={viewerEmail}
                    nameByEmail={nameByEmail}
                    canPost={canPost}
                    busy={busy}
                    onReact={(emoji) =>
                      void post({
                        action: "react",
                        target_id: event.id,
                        emoji,
                      })
                    }
                  />
                  {canPost ? (
                    <button
                      type="button"
                      className="button secondary feed-reply-btn"
                      disabled={busy}
                      onClick={() => setReplyTo(event.id)}
                    >
                      Reply
                    </button>
                  ) : null}
                  {replies.map((c) => (
                    <CommentCard
                      key={c.id}
                      comment={c}
                      feed={feed}
                      viewerEmail={viewerEmail}
                      nameByEmail={nameByEmail}
                      canPost={canPost}
                      canModerate={canModerate}
                      busy={busy}
                      onReact={(emoji) =>
                        void post({
                          action: "react",
                          target_id: c.id,
                          emoji,
                        })
                      }
                      onDelete={() =>
                        void post({
                          action: "delete_comment",
                          comment_id: c.id,
                        })
                      }
                    />
                  ))}
                </article>
              );
            })
          )}
        </section>
      ) : null}
    </div>
  );
}

function ReactionBar({
  targetId,
  feed,
  viewerEmail,
  nameByEmail,
  canPost,
  busy,
  onReact,
}: {
  targetId: string;
  feed: LeagueFeed;
  viewerEmail: string | null;
  nameByEmail?: Record<string, string>;
  canPost: boolean;
  busy: boolean;
  onReact: (emoji: string) => void;
}) {
  const summary = reactionSummaryForViewer(
    feed.reactions,
    targetId,
    viewerEmail,
    nameByEmail,
  );
  return (
    <div className="feed-reactions" role="group" aria-label="Reactions">
      {summary.map((r) => {
        const who = r.names.join(", ");
        return (
          <div key={r.emoji} className="feed-reaction">
            <button
              type="button"
              className={`feed-reaction-btn${r.mine ? " is-mine" : ""}`}
              disabled={busy || !canPost}
              onClick={() => onReact(r.emoji)}
              aria-pressed={r.mine}
              title={who || undefined}
            >
              <span aria-hidden>{r.emoji}</span>
              <span>{r.count}</span>
            </button>
            {who ? (
              <span className="feed-reaction-names league-meta">{who}</span>
            ) : null}
          </div>
        );
      })}
      {canPost
        ? FEED_REACTIONS.filter(
            (emoji) => !summary.some((s) => s.emoji === emoji),
          ).map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="feed-reaction-btn"
              disabled={busy}
              onClick={() => onReact(emoji)}
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))
        : null}
    </div>
  );
}

function CommentCard({
  comment,
  feed,
  viewerEmail,
  nameByEmail,
  canPost,
  canModerate,
  busy,
  onReact,
  onDelete,
}: {
  comment: LeagueFeed["comments"][number];
  feed: LeagueFeed;
  viewerEmail: string | null;
  nameByEmail?: Record<string, string>;
  canPost: boolean;
  canModerate: boolean;
  busy: boolean;
  onReact: (emoji: string) => void;
  onDelete: () => void;
}) {
  const author = liveName(
    comment.author_email,
    comment.author_name,
    nameByEmail,
  );
  return (
    <div className="feed-comment">
      <div className="feed-item-head">
        <span className="feed-author">{author}</span>
        {canModerate ? (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onDelete}
          >
            Delete
          </button>
        ) : null}
      </div>
      <p className="feed-comment-body">{comment.body}</p>
      <ReactionBar
        targetId={comment.id}
        feed={feed}
        viewerEmail={viewerEmail}
        nameByEmail={nameByEmail}
        canPost={canPost}
        busy={busy}
        onReact={onReact}
      />
    </div>
  );
}
