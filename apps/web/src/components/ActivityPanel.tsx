/**
 * League feed shell (roadmap 7.6 / 7.7).
 * Server component: builds the system event stream + digest, loads UGC, then
 * hands a client FeedPanel the live surface.
 */

import { FeedPanel } from "@/components/FeedPanel";
import type { LeagueSnapshot } from "@/lib/data";
import {
  buildWeeklyDigest,
  digestAsFeedEvent,
  latestDigestPeriod,
} from "@/lib/digest";
import { systemFeedEvents, type FeedEventFilter } from "@/lib/feed-events";
import { readFeed } from "@/lib/feed-store";
import type { ActivityView } from "@/lib/activity";
import { getViewer, getViewerFranchise } from "@/lib/viewer";
import { canAccessAdmin, parseAllowedEmailsEnv } from "@/lib/hub-members";
import { readHubMembers } from "@/lib/hub-members-store";
import { devBypassEnabled } from "@/lib/session";

function toEventFilter(view: ActivityView): FeedEventFilter {
  if (view === "trades") return "trades";
  if (view === "waivers") return "waivers";
  if (view === "results") return "results";
  if (view === "draft") return "draft";
  return "all";
}

export async function ActivityPanel({
  league,
  view = "all",
}: {
  league: LeagueSnapshot;
  view?: ActivityView;
}) {
  const filter = toEventFilter(view);
  const events = systemFeedEvents(league, filter === "all" ? "all" : filter);

  const digestPeriod = latestDigestPeriod(league);
  const digestEvents =
    digestPeriod != null
      ? (() => {
          const digest = buildWeeklyDigest(league, digestPeriod);
          return digest ? [digestAsFeedEvent(digest)] : [];
        })()
      : [];

  // Digests ride with "all" and "results"; omit from other filters.
  const merged =
    view === "all" || view === "results"
      ? [...digestEvents, ...events].sort(
          (a, b) => b.sortKey - a.sortKey || a.id.localeCompare(b.id),
        )
      : events;

  const initialFeed = await readFeed(league.league_id, league.season);
  const viewer = await getViewer();
  const franchise = await getViewerFranchise(league.league_id);
  const members = await readHubMembers().catch(() => null);
  const isAdmin =
    devBypassEnabled() ||
    canAccessAdmin(viewer.email, members, {
      envAllowlist: parseAllowedEmailsEnv(process.env.ALLOWED_EMAILS),
      adminEmailsEnv: parseAllowedEmailsEnv(process.env.ADMIN_EMAILS),
    });
  const canPost = Boolean(
    devBypassEnabled() || isAdmin || franchise != null,
  );

  return (
    <FeedPanel
      leagueId={league.league_id}
      season={league.season}
      view={view}
      events={merged}
      initialFeed={initialFeed}
      viewerEmail={viewer.email}
      canPost={canPost}
      canModerate={isAdmin}
      digestPeriod={digestPeriod}
    />
  );
}
