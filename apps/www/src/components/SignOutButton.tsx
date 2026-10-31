"use client";

import { useState } from "react";

import { SignOutDialog } from "@/components/SignOutDialog";

/** A Sign out button that opens the shared "Sign out of all Strictly Jayers sites?" confirm. */
export function SignOutButton({
  className = "acct-btn acct-btn-danger",
  children = "Sign out",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <SignOutDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
