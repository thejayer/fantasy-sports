"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { SIGN_OUT_ALL_PATH, SIGN_OUT_BODY, SIGN_OUT_TITLE } from "@/lib/account-menu";
import { useMounted } from "@/lib/use-mounted";

/**
 * The one sign-out confirm, shared by the avatar menu, /profile and /bets.
 * A dialog on desktop, a bottom sheet on phones. "Sign out" posts a form to
 * /api/signout-all, which signs this site out and walks the browser through
 * the other Strictly Jayers sites. Escape or Cancel closes it and puts focus
 * back where it was.
 */
export function SignOutDialog({
  open,
  onClose,
  action = SIGN_OUT_ALL_PATH,
  returnFocusTo,
}: {
  open: boolean;
  onClose: () => void;
  action?: string;
  /** Where focus goes on close when the opener is gone (the avatar menu unmounts itself first). */
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}) {
  const mounted = useMounted();
  if (!mounted || !open) return null;
  return createPortal(<DialogBody onClose={onClose} action={action} returnFocusTo={returnFocusTo} />, document.body);
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
      className="acct-scrim"
      data-acct-layer="signout"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="acct-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="acct-signout-title"
        aria-describedby="acct-signout-body"
      >
        <span className="acct-sheet-grip" aria-hidden />
        <h2 id="acct-signout-title">{SIGN_OUT_TITLE}</h2>
        <p id="acct-signout-body">{SIGN_OUT_BODY}</p>
        <form method="post" action={action} className="acct-dialog-actions" onSubmit={() => setPending(true)}>
          <button type="submit" className="acct-btn acct-btn-danger" disabled={pending}>
            {pending ? "Signing out…" : "Sign out"}
          </button>
          <button type="button" ref={cancelRef} className="acct-btn" onClick={onClose}>
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
