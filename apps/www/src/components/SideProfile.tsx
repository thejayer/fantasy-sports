"use client";

import { useEffect, useState } from "react";

type SessionUser = { name?: string | null; email?: string | null; image?: string | null };

/** Theme before paint, shared with the hub's Profile & settings page (cookie on *.strictlyjayers.com). */
export const SHARED_THEME_INIT_SCRIPT = `try{var m=document.cookie.match(/(?:^|; )sj-theme=([^;]*)/);var t=m&&decodeURIComponent(m[1]);if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}var c=document.cookie.match(/(?:^|; )sj-accent=([^;]*)/);var a=c&&decodeURIComponent(c[1]);if(a&&/^#[0-9a-fA-F]{6}$/.test(a)){document.documentElement.style.setProperty("--color-accent",a)}}catch(e){}`;

/**
 * Sidebar footer profile row (avatar + name). Every app links to the one
 * shared Profile & settings page on the hub (`{hub}/settings`).
 */
export function SideProfile({
  settingsUrl,
  initialUser = null,
}: {
  settingsUrl: string;
  /** Server-known user; when omitted the row asks /api/auth/session. */
  initialUser?: SessionUser | null;
}) {
  const [user, setUser] = useState<SessionUser | null>(initialUser);

  useEffect(() => {
    if (initialUser) return;
    let alive = true;
    fetch("/api/auth/session", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { user?: SessionUser } | null) => {
        if (alive && data?.user) setUser(data.user);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [initialUser]);

  const label = user?.name || user?.email || "Profile & settings";
  const initials = (user?.name || user?.email || "")
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const image = user?.image && /^https:\/\//i.test(user.image) ? user.image : null;

  return (
    <a
      className="sj-side-item sj-side-profile"
      href={settingsUrl}
      title="Profile & settings"
      rel="noopener noreferrer"
    >
      <span className="sj-side-avatar" aria-hidden>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" width={24} height={24} referrerPolicy="no-referrer" />
        ) : (
          initials || "SJ"
        )}
      </span>
      <span className="sj-side-profile-label">{label}</span>
    </a>
  );
}
