"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { AccentPicker } from "@/components/AccentPicker";

type Props = {
  fantasyHubUrl: string;
  discordInviteUrl: string | null;
};

/** Collapses Places / AI / People / Watch on small screens; Fantasy + Discord stay visible. */
export function PortalNav({ fantasyHubUrl, discordInviteUrl }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    function onResize() {
      if (window.matchMedia("(min-width: 760px)").matches) setOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="portal-nav">
      <nav className="nav-links nav-links-primary" aria-label="Primary">
        <a href={fantasyHubUrl} rel="noopener noreferrer">
          Fantasy
        </a>
        {discordInviteUrl ? (
          <a href={discordInviteUrl} rel="noopener noreferrer">
            Discord
          </a>
        ) : (
          <Link href="/#destinations">Discord</Link>
        )}
        <button
          type="button"
          className="nav-menu-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close" : "More"}
        </button>
        <span className="nav-accent-desktop">
          <AccentPicker />
        </span>
      </nav>

      <nav
        id={panelId}
        className={`nav-links nav-links-more${open ? " is-open" : ""}`}
        aria-label="More places"
      >
        <Link href="/#destinations" onClick={() => setOpen(false)}>
          Places
        </Link>
        <Link href="/ai" onClick={() => setOpen(false)}>
          AI News
        </Link>
        <Link href="/people" onClick={() => setOpen(false)}>
          People
        </Link>
        <Link href="/watch" onClick={() => setOpen(false)}>
          Watch
        </Link>
        <div className="nav-accent-mobile">
          <AccentPicker />
        </div>
      </nav>
    </div>
  );
}
