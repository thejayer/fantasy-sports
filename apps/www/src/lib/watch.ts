/**
 * Shared group YouTube playlist for /watch (roadmap P.5 / P.6 / P.10).
 * Override with YOUTUBE_PLAYLIST_ID on sj-www if the crew swaps lists.
 *
 * Playlist context uses the public YouTube RSS feed — no Data API key.
 */

import { parseFeedItems, type FeedItem } from "@/lib/rss";

export const DEFAULT_YOUTUBE_PLAYLIST_ID =
  "PLKHcH63ZKis3qFZg1O0ZiMrjGyYLa5kB1";

const PLAYLIST_ID_RE = /^[\w-]{10,80}$/;
const YT_VIDEO_ID_RE = /^[\w-]{11}$/;
const FEED_UA = "strictly-jayers-www-watch/1 (+https://strictlyjayers.com)";

export type WatchClip = FeedItem & {
  videoId: string | null;
  thumbnailUrl: string | null;
};

export function getYoutubePlaylistId(): string {
  const fromEnv = process.env.YOUTUBE_PLAYLIST_ID?.trim();
  if (fromEnv && PLAYLIST_ID_RE.test(fromEnv)) return fromEnv;
  return DEFAULT_YOUTUBE_PLAYLIST_ID;
}

export function youtubePlaylistPageUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
}

/** Privacy-enhanced playlist player. Optional `videoId` starts that clip in-list. */
export function youtubePlaylistEmbedUrl(
  playlistId: string,
  videoId?: string | null,
): string {
  const params = new URLSearchParams({
    list: playlistId,
    rel: "0",
  });
  if (videoId && YT_VIDEO_ID_RE.test(videoId)) {
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
  }
  return `https://www.youtube-nocookie.com/embed/videoseries?${params.toString()}`;
}

/** Public Atom feed for a playlist (no API key). */
export function youtubePlaylistFeedUrl(playlistId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;
}

export function youtubeVideoIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
      return YT_VIDEO_ID_RE.test(id) ? id : null;
    }
    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtube-nocookie.com"
    ) {
      const v = parsed.searchParams.get("v");
      if (v && YT_VIDEO_ID_RE.test(v)) return v;
      const parts = parsed.pathname.split("/").filter(Boolean);
      const nested = parts[0] === "embed" || parts[0] === "shorts" ? parts[1] : null;
      if (nested && YT_VIDEO_ID_RE.test(nested)) return nested;
    }
  } catch {
    return null;
  }
  return null;
}

export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
}

export function isYoutubeVideoId(value: string | null | undefined): boolean {
  return Boolean(value && YT_VIDEO_ID_RE.test(value));
}

/** Featured clip: `?v=` when it looks like a YouTube id, else the feed head. */
export function resolveWatchVideoId(
  requested: string | undefined,
  items: readonly WatchClip[],
): string | null {
  if (requested && isYoutubeVideoId(requested)) return requested;
  return items.find((item) => item.videoId)?.videoId ?? null;
}

export function toWatchClip(item: FeedItem): WatchClip {
  const videoId =
    (item.videoId && isYoutubeVideoId(item.videoId) ? item.videoId : null) ??
    youtubeVideoIdFromUrl(item.url);
  const thumbnailUrl =
    item.thumbnailUrl && item.thumbnailUrl.startsWith("http")
      ? item.thumbnailUrl
      : videoId
        ? youtubeThumbnailUrl(videoId)
        : null;
  return { ...item, videoId, thumbnailUrl };
}

export type WatchPlaylist = {
  playlistId: string;
  playlistUrl: string;
  embedUrl: string;
  items: WatchClip[];
  fetchedAt: string;
  feedOk: boolean;
};

/** Fail-soft playlist titles for the Watch room (roadmap P.6 / P.10). */
export async function loadWatchPlaylist(
  limit = 12,
): Promise<WatchPlaylist> {
  const playlistId = getYoutubePlaylistId();
  const playlistUrl = youtubePlaylistPageUrl(playlistId);
  const embedUrl = youtubePlaylistEmbedUrl(playlistId);
  const fetchedAt = new Date().toISOString();

  try {
    const response = await fetch(youtubePlaylistFeedUrl(playlistId), {
      headers: {
        "User-Agent": FEED_UA,
        Accept: "application/atom+xml, application/xml, text/xml, */*",
      },
      next: { revalidate: 1800 },
    });
    if (!response.ok) {
      return {
        playlistId,
        playlistUrl,
        embedUrl,
        items: [],
        fetchedAt,
        feedOk: false,
      };
    }
    const xml = await response.text();
    const items = parseFeedItems(xml, {
      sourceId: "youtube-playlist",
      sourceLabel: "Watch",
      limit,
    }).map(toWatchClip);
    return {
      playlistId,
      playlistUrl,
      embedUrl,
      items,
      fetchedAt,
      feedOk: items.length > 0,
    };
  } catch {
    return {
      playlistId,
      playlistUrl,
      embedUrl,
      items: [],
      fetchedAt,
      feedOk: false,
    };
  }
}
