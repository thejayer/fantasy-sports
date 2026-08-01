/**
 * Shared group YouTube playlist for /watch.
 * Override with YOUTUBE_PLAYLIST_ID on sj-www if the crew swaps lists.
 */
export const DEFAULT_YOUTUBE_PLAYLIST_ID =
  "PLKHcH63ZKis3qFZg1O0ZiMrjGyYLa5kB1";

const PLAYLIST_ID_RE = /^[\w-]{10,80}$/;

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
