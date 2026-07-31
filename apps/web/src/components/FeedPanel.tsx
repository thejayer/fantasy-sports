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
  canPost: boolean;
  canModerate: boolean;
  digestPeriod: number | null;
};

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
    <div className="feed-panel" style={{ marginTop: "0.75rem" }}>
      <p className="lede">
        League feed — transactions, results, and weekly digests interleaved with
        comments, reactions, and polls. System events need no writes; talk is
        stored under the hub root.
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
        <div className="panel" style={{ marginTop: "0.75rem" }}>
          <label className="league-meta" style={{ display: "block" }}>
            {replyTo === FEED_LEAGUE_TARGET
              ? "Post to the league"
              : "Reply to event"}
            <textarea
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Keep it short — this is a friend league, not Twitter."
              style={{ display: "block", width: "100%", marginTop: "0.35rem" }}
            />
          </label>
          <div className="cta-row" style={{ marginTop: "0.5rem", gap: "0.5rem" }}>
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
            <div style={{ marginTop: "0.75rem" }}>
              <label className="league-meta" style={{ display: "block" }}>
                Question
                <input
                  value={pollQuestion}
                  onChange={(e) => setPollQuestion(e.target.value)}
                  maxLength={200}
                  style={{ display: "block", width: "100%", marginTop: "0.35rem" }}
                />
              </label>
              <label
                className="league-meta"
                style={{ display: "block", marginTop: "0.5rem" }}
              >
                Options (one per line)
                <textarea
                  value={pollOptions}
                  onChange={(e) => setPollOptions(e.target.value)}
                  rows={4}
                  style={{ display: "block", width: "100%", marginTop: "0.35rem" }}
                />
              </label>
              <button
                type="button"
                className="button"
                style={{ marginTop: "0.5rem" }}
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
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Link a franchise in /admin to post, react, or create polls.
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
        <section style={{ marginTop: "1rem" }}>
          {view === "talk" ? <h3 style={{ fontSize: "1rem" }}>League talk</h3> : null}
          {livePolls.map((poll) => (
            <article key={poll.id} className="panel feed-item" style={{ marginTop: "0.75rem" }}>
              <header className="league-meta">
                Poll · {poll.author_name}
                {canModerate ? (
                  <button
                    type="button"
                    className="button secondary"
                    style={{ marginLeft: "0.5rem" }}
                    disabled={busy}
                    onClick={() =>
                      void post({ action: "delete_poll", poll_id: poll.id })
                    }
                  >
                    Delete
                  </button>
                ) : null}
              </header>
              <h3 style={{ margin: "0.35rem 0", fontSize: "1.05rem" }}>
                {poll.question}
              </h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
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
                    <li key={opt.id} style={{ marginTop: "0.35rem" }}>
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
                        {total ? ` (${Math.round((opt.voter_emails.length / total) * 100)}%)` : ""}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <ReactionBar
                targetId={poll.id}
                feed={feed}
                viewerEmail={viewerEmail}
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
        <section style={{ marginTop: "1rem" }}>
          {emptySystem ? (
            <EmptyState title="Nothing in this filter">
              Try All, or switch to Talk for member posts.
            </EmptyState>
          ) : (
            filteredEvents.map((event) => {
              const replies = commentsByTarget.get(event.id) ?? [];
              return (
                <article
                  key={event.id}
                  className="panel feed-item"
                  style={{ marginTop: "0.75rem" }}
                >
                  <header className="league-meta">
                    {event.dateLabel} · {event.kind}
                  </header>
                  <h3 style={{ margin: "0.35rem 0", fontSize: "1.05rem" }}>
                    {event.href ? (
                      <Link href={event.href}>{event.title}</Link>
                    ) : (
                      event.title
                    )}
                  </h3>
                  <pre
                    className="league-meta"
                    style={{
                      whiteSpace: "pre-wrap",
                      fontFamily: "inherit",
                      margin: 0,
                    }}
                  >
                    {event.body}
                  </pre>
                  <ReactionBar
                    targetId={event.id}
                    feed={feed}
                    viewerEmail={viewerEmail}
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
                      className="button secondary"
                      style={{ marginTop: "0.35rem" }}
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
  canPost,
  busy,
  onReact,
}: {
  targetId: string;
  feed: LeagueFeed;
  viewerEmail: string | null;
  canPost: boolean;
  busy: boolean;
  onReact: (emoji: string) => void;
}) {
  const summary = reactionSummaryForViewer(
    feed.reactions,
    targetId,
    viewerEmail,
  );
  return (
    <div
      className="cta-row"
      style={{ gap: "0.35rem", marginTop: "0.5rem", flexWrap: "wrap" }}
    >
      {summary.map((r) => (
        <button
          key={r.emoji}
          type="button"
          className={`button${r.mine ? "" : " secondary"}`}
          disabled={busy || !canPost}
          onClick={() => onReact(r.emoji)}
          aria-pressed={r.mine}
        >
          {r.emoji} {r.count}
        </button>
      ))}
      {canPost
        ? FEED_REACTIONS.filter(
            (emoji) => !summary.some((s) => s.emoji === emoji),
          ).map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => onReact(emoji)}
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
  canPost,
  canModerate,
  busy,
  onReact,
  onDelete,
}: {
  comment: LeagueFeed["comments"][number];
  feed: LeagueFeed;
  viewerEmail: string | null;
  canPost: boolean;
  canModerate: boolean;
  busy: boolean;
  onReact: (emoji: string) => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="feed-comment"
      style={{
        marginTop: "0.65rem",
        paddingLeft: "0.75rem",
        borderLeft: "2px solid var(--border, #ccc)",
      }}
    >
      <div className="league-meta">
        {comment.author_name}
        {canModerate ? (
          <button
            type="button"
            className="button secondary"
            style={{ marginLeft: "0.5rem" }}
            disabled={busy}
            onClick={onDelete}
          >
            Delete
          </button>
        ) : null}
      </div>
      <p style={{ margin: "0.25rem 0" }}>{comment.body}</p>
      <ReactionBar
        targetId={comment.id}
        feed={feed}
        viewerEmail={viewerEmail}
        canPost={canPost}
        busy={busy}
        onReact={onReact}
      />
    </div>
  );
}
