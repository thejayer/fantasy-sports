"use client";

import { SignOutButton as ConfirmButton } from "@/components/SignOutDialog";
import { SIGN_OUT_ALL_PATH } from "@/lib/account-menu";

/** A Sign out button that opens the shared "Sign out of all Strictly Jayers sites?" confirm. */
export function SignOutButton({
  className = "acct-btn acct-btn-danger",
  children = "Sign out",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <ConfirmButton action={SIGN_OUT_ALL_PATH} className={className}>
      {children}
    </ConfirmButton>
  );
}
