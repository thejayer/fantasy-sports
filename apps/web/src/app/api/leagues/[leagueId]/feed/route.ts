/**
 * League feed GET/POST (roadmap 7.6).
 * Uncached file under SJ_HUB_DIR — mirrors auction_room.json.
 */

import { NextResponse } from "next/server";

import {
  enforceFeedModerate,
  enforceFeedPost,
} from "@/lib/franchise-acl";
import {
  addComment,
  createPoll,
  deleteComment,
  deletePoll,
  markDigestDelivered,
  toggleReaction,
  votePoll,
  wasDigestDelivered,
  type LeagueFeed,
} from "@/lib/feed";
import { readFeed, writeFeed } from "@/lib/feed-store";
import {
  buildWeeklyDigest,
  formatDigestMessage,
} from "@/lib/digest";
import { deliverDigestToDiscord } from "@/lib/digest-transport";
import { getLeagueSnapshot } from "@/lib/data";
import { getViewer, getViewerFranchise } from "@/lib/viewer";
import { devBypassEnabled, requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ leagueId: string }> };

type ActionBody = {
  action?: string;
  season?: number;
  revision?: number;
  target_id?: string;
  body?: string;
  emoji?: string;
  comment_id?: string;
  poll_id?: string;
  option_id?: string;
  question?: string;
  options?: string[];
  period?: number;
};

async function resolveAuthor(leagueId: string): Promise<{
  email: string;
  name: string;
  team_id: number | null;
} | null> {
  const viewer = await getViewer();
  if (viewer.email) {
    const franchise = await getViewerFranchise(leagueId);
    return {
      email: viewer.email,
      name: viewer.name ?? viewer.email,
      team_id: franchise?.team_id ?? null,
    };
  }
  // AUTH_DEV_BYPASS without SJ_DEV_VIEWER_EMAIL — still allow posts for local
  // tooling, attributed to a stable local identity.
  if (devBypassEnabled()) {
    return { email: "dev@local", name: "Dev", team_id: null };
  }
  return null;
}

export async function GET(request: Request, { params }: Props) {
  await requireSession();
  const { leagueId } = await params;
  const url = new URL(request.url);
  const season = Number(url.searchParams.get("season"));
  if (!Number.isInteger(season)) {
    return NextResponse.json({ error: "season is required" }, { status: 400 });
  }
  const feed = await readFeed(leagueId, season);
  return NextResponse.json({ feed });
}

export async function POST(request: Request, { params }: Props) {
  await requireSession();
  const { leagueId } = await params;

  let body: ActionBody;
  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  const season = Number(body.season);
  const revision = Number(body.revision);
  if (!Number.isInteger(season) || !Number.isInteger(revision)) {
    return NextResponse.json(
      { error: "season and revision are required" },
      { status: 400 },
    );
  }

  const feed = await readFeed(leagueId, season);
  if (feed.revision !== revision) {
    return NextResponse.json(
      { error: "revision conflict", feed },
      { status: 409 },
    );
  }

  const author = await resolveAuthor(leagueId);

  try {
    let next: LeagueFeed;
    switch (action) {
      case "comment": {
        const denied = await enforceFeedPost(leagueId);
        if (denied) return denied;
        if (!author) {
          return NextResponse.json({ error: "sign in required" }, { status: 403 });
        }
        next = addComment(feed, {
          target_id: String(body.target_id ?? "league"),
          body: String(body.body ?? ""),
          author,
        });
        break;
      }
      case "react": {
        const denied = await enforceFeedPost(leagueId);
        if (denied) return denied;
        if (!author) {
          return NextResponse.json({ error: "sign in required" }, { status: 403 });
        }
        next = toggleReaction(feed, {
          target_id: String(body.target_id ?? ""),
          emoji: String(body.emoji ?? ""),
          author_email: author.email,
        });
        break;
      }
      case "delete_comment": {
        const denied = await enforceFeedModerate(leagueId);
        if (denied) return denied;
        next = deleteComment(feed, String(body.comment_id ?? ""));
        break;
      }
      case "create_poll": {
        const denied = await enforceFeedPost(leagueId);
        if (denied) return denied;
        if (!author) {
          return NextResponse.json({ error: "sign in required" }, { status: 403 });
        }
        next = createPoll(feed, {
          question: String(body.question ?? ""),
          options: Array.isArray(body.options)
            ? body.options.map(String)
            : [],
          author,
        });
        break;
      }
      case "vote_poll": {
        const denied = await enforceFeedPost(leagueId);
        if (denied) return denied;
        if (!author) {
          return NextResponse.json({ error: "sign in required" }, { status: 403 });
        }
        next = votePoll(feed, {
          poll_id: String(body.poll_id ?? ""),
          option_id: String(body.option_id ?? ""),
          voter_email: author.email,
        });
        break;
      }
      case "delete_poll": {
        const denied = await enforceFeedModerate(leagueId);
        if (denied) return denied;
        next = deletePoll(feed, String(body.poll_id ?? ""));
        break;
      }
      case "deliver_digest": {
        const denied = await enforceFeedModerate(leagueId);
        if (denied) return denied;
        const period = Number(body.period);
        if (!Number.isInteger(period) || period < 1) {
          return NextResponse.json(
            { error: "period is required" },
            { status: 400 },
          );
        }
        if (wasDigestDelivered(feed, period)) {
          return NextResponse.json({
            feed,
            delivery: { ok: true, channel: "discord", skipped: true },
          });
        }
        const league = await getLeagueSnapshot(leagueId, season);
        if (!league) {
          return NextResponse.json({ error: "league not found" }, { status: 404 });
        }
        const digest = buildWeeklyDigest(league, period);
        if (!digest) {
          return NextResponse.json(
            { error: "no digest for that period" },
            { status: 400 },
          );
        }
        const delivery = await deliverDigestToDiscord(
          formatDigestMessage(digest),
        );
        if (!delivery.ok) {
          return NextResponse.json(
            { error: delivery.error, feed, delivery },
            { status: delivery.channel === "none" ? 503 : 502 },
          );
        }
        next = markDigestDelivered(feed, period);
        break;
      }
      default:
        return NextResponse.json(
          { error: `unknown action: ${action}` },
          { status: 400 },
        );
    }

    // Re-check revision immediately before write (another writer may have won).
    const latest = await readFeed(leagueId, season);
    if (latest.revision !== revision) {
      return NextResponse.json(
        { error: "revision conflict", feed: latest },
        { status: 409 },
      );
    }
    await writeFeed(next);
    return NextResponse.json({ feed: next });
  } catch (err) {
    const message = err instanceof Error ? err.message : "feed action failed";
    return NextResponse.json({ error: message, feed }, { status: 400 });
  }
}
