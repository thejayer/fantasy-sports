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
 * RSS covers the firehose; this is the poster wall.
 */
export const AI_EDITOR_PICKS: EditorPick[] = [
  {
    title: "OpenAI newsroom",
    url: "https://openai.com/news/",
    source: "OpenAI",
    blurb: "Product launches, research, and safety posts from the mothership.",
    date: "Ongoing",
  },
  {
    title: "Anthropic news",
    url: "https://www.anthropic.com/news",
    source: "Anthropic",
    blurb: "Claude releases, policy, and research from Anthropic.",
    date: "Ongoing",
  },
  {
    title: "Cursor changelog & blog",
    url: "https://cursor.com/changelog",
    source: "Cursor",
    blurb: "Editor releases and product notes for the coding agent stack.",
    date: "Ongoing",
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
