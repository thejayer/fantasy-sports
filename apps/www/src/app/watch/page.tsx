import type { Metadata } from "next";
import Link from "next/link";

import { getSiteConfig } from "@/lib/site";
import {
  getYoutubePlaylistId,
  youtubePlaylistEmbedUrl,
  youtubePlaylistPageUrl,
} from "@/lib/watch";

export const metadata: Metadata = {
  title: "Watch",
  description:
    "The Strictly Jayers shared YouTube playlist — click through and watch together.",
};

export default function WatchPage() {
  const { fantasyHubUrl } = getSiteConfig();
  const playlistId = getYoutubePlaylistId();
  const embedUrl = youtubePlaylistEmbedUrl(playlistId);
  const playlistUrl = youtubePlaylistPageUrl(playlistId);

  return (
    <main className="watch-page">
      <section className="page-hero" aria-label="Watch">
        <p className="hero-kicker">Shared queue</p>
        <h1>Watch</h1>
        <p>
          One playlist for the crew. Pick a video in the player, or open the
          full list on YouTube to add more.
        </p>
        <p className="page-hero-meta">
          <a href={playlistUrl} rel="noopener noreferrer">
            Open playlist on YouTube →
          </a>
        </p>
      </section>

      <section className="section watch-player-section" aria-label="Playlist player">
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
        <p className="watch-hint">
          Use the playlist panel in the player to jump between videos. Anyone
          with edit access on YouTube can add or remove clips — this page stays
          in sync.
        </p>
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
