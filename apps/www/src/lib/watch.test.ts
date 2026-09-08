import { describe, expect, it } from "vitest";

import {
  isYoutubeVideoId,
  resolveWatchVideoId,
  toWatchClip,
  youtubePlaylistEmbedUrl,
  youtubeThumbnailUrl,
  youtubeVideoIdFromUrl,
} from "./watch";

describe("youtubeVideoIdFromUrl", () => {
  it("reads watch, short, and embed URLs", () => {
    expect(
      youtubeVideoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoIdFromUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(
      youtubeVideoIdFromUrl("https://www.youtube.com/embed/dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
  });

  it("rejects junk", () => {
    expect(youtubeVideoIdFromUrl("https://example.com/watch?v=nope")).toBeNull();
    expect(isYoutubeVideoId("short")).toBe(false);
    expect(isYoutubeVideoId("dQw4w9WgXcQ")).toBe(true);
  });
});

describe("youtubePlaylistEmbedUrl", () => {
  const list = "PLKHcH63ZKis3qFZg1O0ZiMrjGyYLa5kB1";

  it("keeps the playlist videoseries when no clip is selected", () => {
    expect(youtubePlaylistEmbedUrl(list)).toContain(
      "youtube-nocookie.com/embed/videoseries",
    );
    expect(youtubePlaylistEmbedUrl(list)).toContain(`list=${list}`);
  });

  it("starts a specific clip inside the same playlist", () => {
    const url = youtubePlaylistEmbedUrl(list, "dQw4w9WgXcQ");
    expect(url).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ?");
    expect(url).toContain(`list=${list}`);
    expect(url).not.toContain("videoseries");
  });
});

describe("toWatchClip / resolveWatchVideoId", () => {
  it("prefers feed videoId, then URL, then thumbnail fallback", () => {
    const clip = toWatchClip({
      title: "Clip",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      summary: null,
      publishedAt: null,
      sourceId: "youtube-playlist",
      sourceLabel: "Watch",
    });
    expect(clip.videoId).toBe("dQw4w9WgXcQ");
    expect(clip.thumbnailUrl).toBe(youtubeThumbnailUrl("dQw4w9WgXcQ"));
  });

  it("uses ?v= when it looks like a YouTube id", () => {
    const items = [
      toWatchClip({
        title: "A",
        url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
        summary: null,
        publishedAt: null,
        sourceId: "youtube-playlist",
        sourceLabel: "Watch",
      }),
    ];
    expect(resolveWatchVideoId("dQw4w9WgXcQ", items)).toBe("dQw4w9WgXcQ");
    expect(resolveWatchVideoId("nope", items)).toBe("aaaaaaaaaaa");
  });
});
