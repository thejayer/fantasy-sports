import type { Metadata } from "next";
import Link from "next/link";

import { RoomCrossLinks } from "@/components/RoomCrossLinks";
import { formatFeedDate } from "@/lib/ai-news";
import { getSiteConfig } from "@/lib/site";
import {
  resolveWatchVideoId,
  youtubePlaylistEmbedUrl,
  loadWatchPlaylist,
} from "@/lib/watch";

export const metadata: Metadata = {
  title: "Watch",
  description:
    "The Strictly Jayers shared YouTube playlist — click through and watch together.",
};

export const revalidate = 1800;

export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const { v } = await searchParams;
  const { fantasyHubUrl, fitnessUrl, discordInviteUrl } = getSiteConfig();
  const playlist = await loadWatchPlaylist(12);
  const featuredId = resolveWatchVideoId(v, playlist.items);
  const embedUrl = youtubePlaylistEmbedUrl(playlist.playlistId, featuredId);
  const featuredIndex = featuredId
    ? playlist.items.findIndex((item) => item.videoId === featuredId)
    : 0;
  const playingIndex = featuredIndex >= 0 ? featuredIndex : 0;
  const tonight = playlist.items[playingIndex] ?? playlist.items[0] ?? null;

  return (
    <main className="watch-page">
      <section className="page-hero" aria-label="Watch">
        <p className="hero-kicker">Shared queue</p>
        <h1>Watch</h1>
        <p>
          One playlist for the crew. Hit tonight’s pick, queue the next clip, or
          jump Discord voice while it plays.
        </p>
        <p className="page-hero-meta">
          {playlist.feedOk
            ? `${playlist.items.length} recent clip${playlist.items.length === 1 ? "" : "s"} from the feed`
            : "Playlist feed temporarily unavailable — player still works"}
          {" · "}
          <a href={playlist.playlistUrl} rel="noopener noreferrer">
            Open on YouTube →
          </a>
        </p>
      </section>

      <section className="section watch-stage-section" aria-label="Now playing">
        <div className="watch-stage">
          <div className="watch-stage-player">
            <div className="watch-player">
              <iframe
                src={embedUrl}
                title="Strictly Jayers YouTube playlist"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
            {tonight ? (
              <div className="watch-now-copy">
                <p className="watch-now-kicker">Tonight’s pick</p>
                <h2>{tonight.title}</h2>
                <p>
                  {formatFeedDate(tonight.publishedAt)}
                  {playlist.feedOk ? (
                    <>
                      {" · "}
                      <time dateTime={playlist.fetchedAt}>
                        feed {formatFeedDate(playlist.fetchedAt)} UTC
                      </time>
                    </>
                  ) : null}
                </p>
              </div>
            ) : (
              <p className="watch-hint">
                Use the playlist panel in the player to jump between videos.
                Anyone with edit access on YouTube can add or remove clips.
              </p>
            )}
          </div>

          <aside className="watch-queue-panel" aria-labelledby="queue-heading">
            <div className="watch-queue-head">
              <h2 id="queue-heading">Video playlist</h2>
              <p>
                {playlist.items.length > 0
                  ? `${playingIndex + 1}/${playlist.items.length} videos`
                  : "Queue"}
              </p>
            </div>
            {playlist.items.length === 0 ? (
              <p className="empty-note">
                Titles are unavailable right now. Use the player or{" "}
                <a href={playlist.playlistUrl} rel="noopener noreferrer">
                  open the playlist on YouTube
                </a>
                .
              </p>
            ) : (
              <ol className="watch-queue">
                {playlist.items.map((item, index) => {
                  const active =
                    (item.videoId && item.videoId === featuredId) ||
                    (!featuredId && index === 0);
                  const href = item.videoId
                    ? `/watch?v=${encodeURIComponent(item.videoId)}`
                    : item.url;
                  const inner = (
                    <>
                      <span className="watch-queue-index">{index + 1}</span>
                      <span className="watch-queue-thumb">
                        {item.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.thumbnailUrl}
                            alt=""
                            width={128}
                            height={72}
                          />
                        ) : (
                          <span className="watch-queue-thumb-fallback" />
                        )}
                        {active ? (
                          <span className="watch-queue-playing">Playing</span>
                        ) : null}
                      </span>
                      <span className="watch-queue-meta">
                        <span className="watch-queue-title">{item.title}</span>
                        <span className="watch-queue-date">
                          {formatFeedDate(item.publishedAt)}
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <li key={item.url}>
                      {item.videoId ? (
                        <Link
                          className={
                            active
                              ? "watch-queue-row is-active"
                              : "watch-queue-row"
                          }
                          href={href}
                          aria-current={active ? "true" : undefined}
                        >
                          {inner}
                        </Link>
                      ) : (
                        <a
                          className={
                            active
                              ? "watch-queue-row is-active"
                              : "watch-queue-row"
                          }
                          href={item.url}
                          rel="noopener noreferrer"
                        >
                          {inner}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </aside>
        </div>

        <p className="watch-hint">
          Anyone with edit access on YouTube can add or remove clips — this page
          stays in sync. Feed list refreshes about every 30 minutes.
        </p>
        <p className="cta-row watch-cta-row">
          {discordInviteUrl ? (
            <>
              <a
                className="cta cta-on-light"
                href={discordInviteUrl}
                rel="noopener noreferrer"
              >
                Drop a clip in Discord →
              </a>
              <a
                className="cta cta-ghost"
                href={discordInviteUrl}
                rel="noopener noreferrer"
              >
                Jump voice →
              </a>
            </>
          ) : null}
          <a
            className="cta cta-ghost"
            href={playlist.playlistUrl}
            rel="noopener noreferrer"
          >
            Open full playlist →
          </a>
        </p>
      </section>

      <section className="section" aria-labelledby="room-heading">
        <div className="section-head">
          <div>
            <h2 id="room-heading">How we use this</h2>
            <p>
              Drop clips for draft night, golf Sundays, or whatever Discord is
              arguing about. Hit voice, share the pick, then come back to the
              hub when the waiver wire opens.
            </p>
          </div>
          <div className="section-marker">ROOM</div>
        </div>
        <ul className="watch-room-links">
          <li>
            <a href={fantasyHubUrl} rel="noopener noreferrer">
              Fantasy hub →
            </a>
          </li>
          {discordInviteUrl ? (
            <li>
              <a href={discordInviteUrl} rel="noopener noreferrer">
                Jump Discord voice →
              </a>
            </li>
          ) : null}
        </ul>
      </section>

      <RoomCrossLinks current="watch" />

      <footer className="site-footer">
        <Link href="/">← Strictly Jayers</Link>
        <span>
          <a href={fitnessUrl} rel="noopener noreferrer">
            Fitness →
          </a>
          {" · "}
          <a href={fantasyHubUrl} rel="noopener noreferrer">
            Fantasy hub →
          </a>
        </span>
      </footer>
    </main>
  );
}
