/**
 * AI News sources for the apex portal (roadmap P.4).
 *
 * Headlines come from RSS (official + maintained mirrors). Timeline slots use
 * public X profile embeds — no paid X API. Editor picks are curated locally.
 */

import {
  parseFeedItems,
  sortFeedItemsByDate,
  type FeedItem,
} from "@/lib/rss";

export type RssSource = {
  id: string;
  label: string;
  /** Homepage for the source (not the feed). */
  siteUrl: string;
  feedUrl: string;
  /** Soft cap per source before the merge. */
  limit: number;
};

export type TimelineAccount = {
  id: string;
  label: string;
  /** X / Twitter handle without @. */
  handle: string;
};

export type EditorPick = {
  title: string;
  url: string;
  source: string;
  blurb: string;
  /** ISO date or human label. */
  date: string;
};

/** Company / lab feeds — fail soft per source if a feed is down. */
export const AI_RSS_SOURCES: RssSource[] = [
  {
    id: "openai",
    label: "OpenAI",
    siteUrl: "https://openai.com/news",
    feedUrl: "https://openai.com/news/rss.xml",
    limit: 6,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    siteUrl: "https://www.anthropic.com/news",
    // Anthropic has no official RSS; community mirror refreshed hourly.
    feedUrl:
      "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml",
    limit: 6,
  },
  {
    id: "cursor",
    label: "Cursor",
    siteUrl: "https://cursor.com/blog",
    feedUrl:
      "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_cursor.xml",
    limit: 6,
  },
  {
    id: "google-ai",
    label: "Google AI",
    siteUrl: "https://blog.google/technology/ai/",
    feedUrl: "https://blog.google/technology/ai/rss/",
    limit: 4,
  },
];

/** Public X timelines — rendered via platform.twitter.com widgets. */
export const AI_TIMELINE_ACCOUNTS: TimelineAccount[] = [
  { id: "openai", label: "OpenAI", handle: "OpenAI" },
  { id: "anthropic", label: "Anthropic", handle: "AnthropicAI" },
  { id: "cursor", label: "Cursor", handle: "cursor_ai" },
];

/**
 * Hand-picked “big stories”. Edit this list when something major lands —
 * RSS covers the firehose; this is the poster wall. Prefer dated articles
 * over source homepages so the desk reads editorial.
 */
export const AI_EDITOR_PICKS: EditorPick[] = [
  {
    title: "AMIE tries real-time clinical video consults",
    url: "https://blog.google/innovation-and-ai/models-and-research/google-research/amie-video-consultations/",
    source: "Google AI",
    blurb:
      "Google Research study on AMIE in simulated clinical video consultations.",
    date: "Aug 11, 2026",
  },
  {
    title: "Improving Fable 5's biology safeguards",
    url: "https://www.anthropic.com/news/improving-fable-5-s-biology-safeguards",
    source: "Anthropic",
    blurb:
      "Fewer false-positive biology fallbacks on Claude Fable 5 — dual-use topics still gated.",
    date: "Aug 7, 2026",
  },
  {
    title: "How Cursor Router chooses the right model",
    url: "https://cursor.com/blog/how-cursor-router-works",
    source: "Cursor",
    blurb:
      "How Auto routes a task to the right model without making you pick every time.",
    date: "Aug 6, 2026",
  },
  {
    title: "Testing ads in ChatGPT",
    url: "https://openai.com/index/testing-ads-in-chatgpt",
    source: "OpenAI",
    blurb:
      "Labeled ads on Free/Go ChatGPT — privacy controls and answer independence called out.",
    date: "Feb 9, 2026",
  },
];

const FEED_UA = "strictly-jayers-www-ai-news/1 (+https://strictlyjayers.com)";

async function fetchOneFeed(source: RssSource): Promise<FeedItem[]> {
  try {
    const response = await fetch(source.feedUrl, {
      headers: { "User-Agent": FEED_UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
      next: { revalidate: 1800 },
    });
    if (!response.ok) return [];
    const xml = await response.text();
    return parseFeedItems(xml, {
      sourceId: source.id,
      sourceLabel: source.label,
      limit: source.limit,
    });
  } catch {
    return [];
  }
}

/** Merge all configured feeds, newest first. */
export async function loadAiHeadlines(limit = 24): Promise<{
  items: FeedItem[];
  fetchedAt: string;
  sourcesOk: number;
  sourcesTotal: number;
}> {
  const batches = await Promise.all(AI_RSS_SOURCES.map(fetchOneFeed));
  const sourcesOk = batches.filter((b) => b.length > 0).length;
  const items = sortFeedItemsByDate(batches.flat()).slice(0, limit);
  return {
    items,
    fetchedAt: new Date().toISOString(),
    sourcesOk,
    sourcesTotal: AI_RSS_SOURCES.length,
  };
}

export function formatFeedDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
