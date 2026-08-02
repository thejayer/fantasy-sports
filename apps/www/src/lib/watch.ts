/**
 * Shared group YouTube playlist for /watch (roadmap P.5 / P.6).
 * Override with YOUTUBE_PLAYLIST_ID on sj-www if the crew swaps lists.
 *
 * Playlist context uses the public YouTube RSS feed — no Data API key.
 */

import { parseFeedItems, type FeedItem } from "@/lib/rss";

export const DEFAULT_YOUTUBE_PLAYLIST_ID =
  "PLKHcH63ZKis3qFZg1O0ZiMrjGyYLa5kB1";

const PLAYLIST_ID_RE = /^[\w-]{10,80}$/;
const FEED_UA = "strictly-jayers-www-watch/1 (+https://strictlyjayers.com)";

export function getYoutubePlaylistId(): string {
  const fromEnv = process.env.YOUTUBE_PLAYLIST_ID?.trim();
  if (fromEnv && PLAYLIST_ID_RE.test(fromEnv)) return fromEnv;
  return DEFAULT_YOUTUBE_PLAYLIST_ID;
}

export function youtubePlaylistPageUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
}

/** Privacy-enhanced playlist player (sidebar of videos + embed). */
export function youtubePlaylistEmbedUrl(playlistId: string): string {
  const params = new URLSearchParams({
    list: playlistId,
    rel: "0",
  });
  return `https://www.youtube-nocookie.com/embed/videoseries?${params.toString()}`;
}

/** Public Atom feed for a playlist (no API key). */
export function youtubePlaylistFeedUrl(playlistId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;
}

export type WatchPlaylist = {
  playlistId: string;
  playlistUrl: string;
  embedUrl: string;
  items: FeedItem[];
  fetchedAt: string;
  feedOk: boolean;
};

/** Fail-soft playlist titles for the Watch room (roadmap P.6). */
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
    });
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
