/**
 * Minimal RSS 2.0 / Atom item extraction — no XML library.
 * Good enough for company blog feeds (OpenAI, Google, community mirrors).
 */

export type FeedItem = {
  title: string;
  url: string;
  summary: string | null;
  publishedAt: string | null;
  sourceId: string;
  sourceLabel: string;
};

function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tagContent(block: string, tag: string): string | null {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "i",
  );
  const match = block.match(re);
  if (!match?.[1]) return null;
  const raw = match[1].trim();
  return raw ? decodeEntities(raw) : null;
}

function linkFromItem(block: string): string | null {
  const tagged = tagContent(block, "link");
  if (tagged?.startsWith("http")) return tagged;
  const atom = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  if (atom?.[1]?.startsWith("http")) return atom[1];
  const guid = tagContent(block, "guid");
  if (guid?.startsWith("http")) return guid;
  return null;
}

function publishedFromItem(block: string): string | null {
  const raw =
    tagContent(block, "pubDate") ||
    tagContent(block, "published") ||
    tagContent(block, "updated") ||
    tagContent(block, "dc:date");
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString();
}

/** Parse `<item>` / `<entry>` blocks from an RSS or Atom document. */
export function parseFeedItems(
  xml: string,
  opts: { sourceId: string; sourceLabel: string; limit?: number },
): FeedItem[] {
  const limit = opts.limit ?? 8;
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ].map((m) => m[1] ?? "");

  const items: FeedItem[] = [];
  for (const block of blocks) {
    const title = tagContent(block, "title");
    const url = linkFromItem(block);
    if (!title || !url) continue;
    const summary =
      tagContent(block, "description") ||
      tagContent(block, "summary") ||
      tagContent(block, "content") ||
      null;
    items.push({
      title,
      url,
      summary: summary ? summary.slice(0, 280) : null,
      publishedAt: publishedFromItem(block),
      sourceId: opts.sourceId,
      sourceLabel: opts.sourceLabel,
    });
    if (items.length >= limit) break;
  }
  return items;
}

export function sortFeedItemsByDate(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });
}
