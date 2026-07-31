import type { Metadata } from "next";
import Link from "next/link";

import { XTimelineGrid } from "@/components/XTimeline";
import {
  AI_EDITOR_PICKS,
  AI_RSS_SOURCES,
  AI_TIMELINE_ACCOUNTS,
  formatFeedDate,
  loadAiHeadlines,
} from "@/lib/ai-news";
import { getSiteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "AI News",
  description:
    "Headlines from OpenAI, Anthropic, Cursor, and Google AI — plus live timelines.",
};

export const revalidate = 1800;

export default async function AiNewsPage() {
  const { fantasyHubUrl } = getSiteConfig();
  const { items, sourcesOk, sourcesTotal, fetchedAt } = await loadAiHeadlines(28);

  return (
    <main className="ai-news">
      <section className="page-hero" aria-label="AI News">
        <p className="hero-kicker">Stay sharp</p>
        <h1>AI News</h1>
        <p>
          Company posts, lab notes, and live timelines from the shops that
          shape how we build — OpenAI, Anthropic, Cursor, and more.
        </p>
        <p className="page-hero-meta">
          Feeds refreshed about every 30 minutes
          {sourcesOk > 0
            ? ` · ${sourcesOk}/${sourcesTotal} sources live`
            : " · feeds temporarily unavailable"}
          {" · "}
          <time dateTime={fetchedAt}>
            pulled {formatFeedDate(fetchedAt)} UTC
          </time>
        </p>
      </section>

      <section className="section" aria-labelledby="picks-heading">
        <div className="section-head">
          <div>
            <h2 id="picks-heading">Big stories</h2>
            <p>Editor desk — the rooms worth bookmarking when something ships.</p>
          </div>
          <div className="section-marker">PICKS</div>
        </div>
        <ul className="story-list">
          {AI_EDITOR_PICKS.map((pick) => (
            <li key={pick.url}>
              <a
                className="story-row"
                href={pick.url}
                rel="noopener noreferrer"
              >
                <div className="story-meta">
                  <span>{pick.source}</span>
                  <span>{pick.date}</span>
                </div>
                <h3>{pick.title}</h3>
                <p>{pick.blurb}</p>
                <span className="story-action">Read →</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="section" aria-labelledby="headlines-heading">
        <div className="section-head">
          <div>
            <h2 id="headlines-heading">Latest headlines</h2>
            <p>
              Merged from{" "}
              {AI_RSS_SOURCES.map((s) => s.label).join(", ")}.
            </p>
          </div>
          <div className="section-marker">RSS</div>
        </div>
        {items.length === 0 ? (
          <p className="empty-note">
            No headlines right now — check back after the next refresh, or open
            a source below.
          </p>
        ) : (
          <ul className="headline-list">
            {items.map((item) => (
              <li key={`${item.sourceId}-${item.url}`}>
                <a
                  className="headline-row"
                  href={item.url}
                  rel="noopener noreferrer"
                >
                  <div className="headline-meta">
                    <span className="headline-source">{item.sourceLabel}</span>
                    {item.publishedAt ? (
                      <time dateTime={item.publishedAt}>
                        {formatFeedDate(item.publishedAt)}
                      </time>
                    ) : null}
                  </div>
                  <h3>{item.title}</h3>
                  {item.summary ? <p>{item.summary}</p> : null}
                </a>
              </li>
            ))}
          </ul>
        )}
        <ul className="source-chips">
          {AI_RSS_SOURCES.map((source) => (
            <li key={source.id}>
              <a href={source.siteUrl} rel="noopener noreferrer">
                {source.label}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="section" aria-labelledby="timelines-heading">
        <div className="section-head">
          <div>
            <h2 id="timelines-heading">Timelines</h2>
            <p>
              Live X profiles via official embeds — open the handle if a widget
              stays blank.
            </p>
          </div>
          <div className="section-marker">X</div>
        </div>
        <XTimelineGrid accounts={AI_TIMELINE_ACCOUNTS} />
      </section>

      <footer className="site-footer">
        <Link href="/">← Strictly Jayers</Link>
        <a href={fantasyHubUrl} rel="noopener noreferrer">
          Fantasy hub →
        </a>
      </footer>
    </main>
  );
}
