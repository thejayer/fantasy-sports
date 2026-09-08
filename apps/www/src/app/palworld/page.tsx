import type { Metadata } from "next";
import Link from "next/link";

import { RoomCrossLinks } from "@/components/RoomCrossLinks";
import { hasPalworldJoinContent, portalCopy } from "@/lib/content";
import { getSiteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Palworld",
  description:
    "Strictly Jayers Palworld room — world status and how to join. Passwords stay in Discord.",
};

export default function PalworldPage() {
  const { fantasyHubUrl, fitnessUrl, discordInviteUrl, palworldInfoUrl, palworldStatus } =
    getSiteConfig();
  const room = portalCopy.palworld;
  const status = palworldStatus?.trim() || room.status;
  const ready = hasPalworldJoinContent(room, palworldStatus);

  return (
    <main className="palworld-page">
      <section className="page-hero" aria-label="Palworld">
        <p className="hero-kicker">{room.kicker}</p>
        <h1>{room.heading}</h1>
        <p>{room.support}</p>
      </section>

      {ready ? (
        <section className="section" aria-labelledby="status-heading">
          <div className="section-head">
            <div>
              <h2 id="status-heading">{room.statusLabel}</h2>
              <p>Public line only. Server addresses stay off this site.</p>
            </div>
            <div className="section-marker">{room.marker}</div>
          </div>
          <div className="join-card">
            <p className="join-card-kicker">Now</p>
            <p className="join-card-body">{status}</p>
          </div>
        </section>
      ) : (
        <section className="section">
          <p className="empty-note">{room.empty}</p>
        </section>
      )}

      <section className="section" aria-labelledby="join-heading">
        <div className="section-head">
          <div>
            <h2 id="join-heading">{room.howToJoinHeading}</h2>
            <p>Three steps. The actual password is a Discord ping away.</p>
          </div>
          <div className="section-marker">JOIN</div>
        </div>
        <ol className="join-steps">
          {room.steps.map((step, index) => (
            <li key={step.title} className="join-card">
              <p className="join-card-kicker">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h3>{step.title}</h3>
              <p className="join-card-body">{step.body}</p>
            </li>
          ))}
        </ol>
        <p className="cta-row watch-cta-row">
          {discordInviteUrl ? (
            <a
              className="cta cta-on-light"
              href={discordInviteUrl}
              rel="noopener noreferrer"
            >
              {room.discordCta} →
            </a>
          ) : (
            <Link className="cta cta-on-light" href="/#destinations">
              {room.discordCta} →
            </Link>
          )}
          {palworldInfoUrl ? (
            <a
              className="cta cta-ghost"
              href={palworldInfoUrl}
              rel="noopener noreferrer"
            >
              {room.extraInfoCta} →
            </a>
          ) : null}
        </p>
      </section>

      <RoomCrossLinks current="palworld" />

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
