"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  IconLink,
  IconSettings,
  IconSignIn,
  IconSignOut,
  IconUser,
} from "@/components/AccountIcons";
import { SignOutDialog } from "@/components/SignOutDialog";
import { useMounted } from "@/lib/use-mounted";
import { initialsOf, safeAvatar, type MeResponse, type MenuItem } from "@/lib/account-menu";

const ICONS: Record<MenuItem["id"], () => React.JSX.Element> = {
  profile: IconUser,
  "link-teams": IconLink,
  settings: IconSettings,
};

function Avatar({ name, image, size }: { name: string | null; image: string | null; size: "sm" | "lg" }) {
  const url = safeAvatar(image);
  return (
    <span className={`acct-avatar acct-avatar-${size}`} aria-hidden>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" referrerPolicy="no-referrer" />
      ) : (
        initialsOf(name) || "SJ"
      )}
    </span>
  );
}

/**
 * The account menu: Profile, Link teams, Settings, then Sign out. It sits in
 * the sidebar footer on every www page (the trigger is the profile row, in the
 * header on phones). A dropdown on desktop, a bottom sheet on phones. Escape or
 * an outside tap closes it and focus goes back to the trigger. Signed out, the
 * row is a plain "Sign in" link. The data comes from /api/me.
 */
export function AvatarMenu({ initial = null }: { initial?: MeResponse | null }) {
  const [me, setMe] = useState<MeResponse | null>(initial);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const mounted = useMounted();
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initial) return;
    let alive = true;
    fetch("/api/me", { credentials: "same-origin", cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<MeResponse>) : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (alive) setMe(data);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [initial]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Tab") {
        close(false);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const rows = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      if (rows.length === 0) return;
      event.preventDefault();
      const at = rows.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.length - 1
            : event.key === "ArrowDown"
              ? (at + 1) % rows.length
              : (at - 1 + rows.length) % rows.length;
      rows[next]?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Signed out (or the lookup failed): a plain Sign in link in the same spot.
  if ((me && !me.signedIn) || failed) {
    const path = typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;
    return (
      <a
        className="sj-side-item sj-side-profile"
        href={`${me?.signIn ?? "/login"}?callbackUrl=${encodeURIComponent(path.startsWith("/") ? path : "/")}`}
      >
        <span className="sj-side-avatar" aria-hidden>
          <IconSignIn />
        </span>
        <span className="sj-side-profile-label">Sign in</span>
      </a>
    );
  }

  const name = me?.user?.name ?? null;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="sj-side-item sj-side-profile"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={name ? `Account menu, ${name}` : "Account menu"}
        disabled={!me}
        onClick={() => {
          const rect = trigger.current?.getBoundingClientRect();
          if (rect) setAnchor({ left: Math.max(8, rect.left), bottom: Math.max(8, window.innerHeight - rect.top + 8) });
          setOpen((v) => !v);
        }}
        data-testid="account-menu-trigger"
      >
        <span className="sj-side-avatar" aria-hidden>
          {safeAvatar(me?.user?.image) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={safeAvatar(me?.user?.image) ?? ""} alt="" width={24} height={24} referrerPolicy="no-referrer" />
          ) : (
            initialsOf(name) || "SJ"
          )}
        </span>
        <span className="sj-side-profile-label">{name ?? "Account"}</span>
      </button>
      {mounted && open && me
        ? createPortal(
            <div
              className="acct-scrim acct-scrim-menu"
              data-acct-layer="menu"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) close();
              }}
            >
              <div
                ref={menu}
                className="acct-menu"
                role="menu"
                aria-label="Account"
                data-testid="account-menu"
                style={
                  anchor
                    ? ({ "--acct-left": `${anchor.left}px`, "--acct-bottom": `${anchor.bottom}px` } as React.CSSProperties)
                    : undefined
                }
              >
                <span className="acct-sheet-grip" aria-hidden />
                <div className="acct-menu-head">
                  <Avatar name={name} image={me.user?.image ?? null} size="lg" />
                  <span className="acct-menu-name">{name}</span>
                </div>
                {me.items.map((item) => {
                  const Icon = ICONS[item.id];
                  return (
                    <a key={item.id} role="menuitem" className="acct-menu-row" href={item.href} onClick={() => setOpen(false)}>
                      <Icon />
                      <span>{item.label}</span>
                    </a>
                  );
                })}
                <hr className="acct-menu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="acct-menu-row acct-menu-row-danger"
                  onClick={() => {
                    setOpen(false);
                    setConfirm(true);
                  }}
                >
                  <IconSignOut />
                  <span>Sign out</span>
                </button>
                <button type="button" role="menuitem" className="acct-menu-row acct-menu-cancel" onClick={() => close()}>
                  <span>Close</span>
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
      <SignOutDialog
        open={confirm}
        onClose={() => {
          setConfirm(false);
        }}
        action={me?.signOut}
        returnFocusTo={trigger}
      />
    </>
  );
}
