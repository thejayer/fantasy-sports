"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The one sign-out confirm, "Sign out of all Strictly Jayers sites?", used by
 * www, hub and vibe (fitness mirrors it in sj-chrome.js, the casino in its own
 * AccountMenu). A dialog on desktop, a bottom sheet on phones; the styles live
 * in sj-ui (.sj-confirm*). "Sign out" posts a form to `action`, the site's own
 * sign-out-all route, which signs this site out and walks the browser through
 * the others. Escape or Cancel closes it and puts focus back where it was.
 *
 * This file is identical in apps/www, apps/web and apps/vibe;
 * packages/sj-ui/check.sh fails if the copies drift.
 */
export const SIGN_OUT_TITLE = "Sign out of all Strictly Jayers sites?";
export const SIGN_OUT_BODY = "You'll need to sign in with Google again.";

export function SignOutDialog({
  open,
  onClose,
  action,
  returnFocusTo,
}: {
  open: boolean;
  onClose: () => void;
  /** This site's sign-out-all route (www: /api/signout-all, others: /api/auth/signout-all). */
  action: string;
  /** Where focus goes on close when the opener is gone (the avatar menu unmounts itself first). */
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}) {
  // Only ever opened by a click, so this never renders on the server.
  if (!open || typeof document === "undefined") return null;
  return createPortal(<DialogBody onClose={onClose} action={action} returnFocusTo={returnFocusTo} />, document.body);
}

/** A button that opens the confirm. `className` is the site's own button style. */
export function SignOutButton({
  action,
  className,
  children = "Sign out",
}: {
  action: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <SignOutDialog open={open} onClose={() => setOpen(false)} action={action} />
    </>
  );
}

function DialogBody({
  onClose,
  action,
  returnFocusTo,
}: {
  onClose: () => void;
  action: string;
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}) {
  const [pending, setPending] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = returnFocusTo?.current ?? null;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]");
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (target ?? opener)?.focus?.();
    };
  }, [onClose, returnFocusTo]);

  return (
    <div
      className="sj-confirm-scrim"
      data-sj-confirm="signout"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="sj-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sj-confirm-title"
        aria-describedby="sj-confirm-body"
      >
        <span className="sj-confirm-grip" aria-hidden />
        <h2 id="sj-confirm-title">{SIGN_OUT_TITLE}</h2>
        <p id="sj-confirm-body">{SIGN_OUT_BODY}</p>
        <form method="post" action={action} className="sj-confirm-actions" onSubmit={() => setPending(true)}>
          <button type="submit" className="sj-confirm-btn sj-confirm-btn-danger" disabled={pending}>
            {pending ? "Signing out…" : "Sign out"}
          </button>
          <button type="button" ref={cancelRef} className="sj-confirm-btn" onClick={onClose}>
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
