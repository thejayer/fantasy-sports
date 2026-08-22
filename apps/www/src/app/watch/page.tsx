import type { Metadata } from "next";
import Link from "next/link";

import { formatFeedDate } from "@/lib/ai-news";
import { getSiteConfig } from "@/lib/site";
import { loadWatchPlaylist } from "@/lib/watch";

export const metadata: Metadata = {
  title: "Watch",
  description:
    "The Strictly Jayers shared YouTube playlist — click through and watch together.",
};

export const revalidate = 1800;

export default async function WatchPage() {
  const { fantasyHubUrl, fitnessUrl, discordInviteUrl } = getSiteConfig();
  const playlist = await loadWatchPlaylist(12);
  const tonight = playlist.items[0] ?? null;

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

      {tonight ? (
        <section
          className="section tonight-pick"
          aria-labelledby="tonight-heading"
        >
          <div className="section-head">
            <div>
              <h2 id="tonight-heading">Tonight’s pick</h2>
              <p>Top of the shared playlist feed — start here.</p>
            </div>
            <div className="section-marker">NOW</div>
          </div>
          <a
            className="tonight-card"
            href={tonight.url}
            rel="noopener noreferrer"
          >
            <div className="story-meta">
              <span>Featured</span>
              <span>{formatFeedDate(tonight.publishedAt)}</span>
            </div>
            <h3>{tonight.title}</h3>
            <span className="story-action">Play on YouTube →</span>
          </a>
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
      ) : null}

      <section className="section watch-player-section" aria-label="Playlist player">
        <div className="section-head">
          <div>
            <h2>Now playing</h2>
            <p>Use the playlist panel in the player to jump between videos.</p>
          </div>
          <div className="section-marker">LIVE</div>
        </div>
        <div className="watch-player">
          <iframe
            src={playlist.embedUrl}
            title="Strictly Jayers YouTube playlist"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
        <p className="watch-hint">
          Anyone with edit access on YouTube can add or remove clips — this page
          stays in sync. Feed list refreshes about every 30 minutes.
          {playlist.feedOk ? (
            <>
              {" "}
              Pulled{" "}
              <time dateTime={playlist.fetchedAt}>
                {formatFeedDate(playlist.fetchedAt)} UTC
              </time>
              .
            </>
          ) : null}
        </p>
        <p className="cta-row watch-cta-row">
          <a
            className="cta cta-on-light"
            href={playlist.playlistUrl}
            rel="noopener noreferrer"
          >
            Open playlist →
          </a>
          {discordInviteUrl ? (
            <a
              className="cta cta-ghost"
              href={discordInviteUrl}
              rel="noopener noreferrer"
            >
              Discord voice →
            </a>
          ) : null}
        </p>
      </section>

      <section className="section" aria-labelledby="queue-heading">
        <div className="section-head">
          <div>
            <h2 id="queue-heading">On the list</h2>
            <p>
              Recent titles from the public playlist feed — tap to open on
              YouTube.
            </p>
          </div>
          <div className="section-marker">QUEUE</div>
        </div>
        {playlist.items.length === 0 ? (
          <p className="empty-note">
            Titles are unavailable right now. Use the player above or{" "}
            <a href={playlist.playlistUrl} rel="noopener noreferrer">
              open the playlist on YouTube
            </a>
            .
          </p>
        ) : (
          <ul className="headline-list watch-queue">
            {playlist.items.map((item, index) => (
              <li key={item.url}>
                <a
                  className="headline-row"
                  href={item.url}
                  rel="noopener noreferrer"
                >
                  <div className="story-meta">
                    <span>#{index + 1}</span>
                    <span>{formatFeedDate(item.publishedAt)}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <span className="story-action">Watch on YouTube →</span>
                </a>
              </li>
            ))}
          </ul>
        )}
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
          <li>
            <Link href="/ai">AI News →</Link>
          </li>
          <li>
            <Link href="/people">People →</Link>
          </li>
        </ul>
      </section>

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
