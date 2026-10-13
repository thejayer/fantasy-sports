/**
 * Google sign-in + per-request allowlist (same rule as Fantasy / Fitness).
 * AUTH_DEV_BYPASS never skips a real OAuth profile — middleware / getBetsActor
 * mint a local actor without creating a session.
 */

import {
  isEmailAllowed,
  parseAllowedEmailsEnv,
} from "@/lib/allowlist";

export async function emailOnAllowlist(email: string): Promise<boolean> {
  const envEmails = parseAllowedEmailsEnv(process.env.ALLOWED_EMAILS);
  let file = null;
  try {
    const { readHubMembers } = await import("@/lib/members-store");
    file = await readHubMembers();
  } catch {
    file = null;
  }
  return isEmailAllowed(email, envEmails, file);
}

/** Real Google sign-in always uses the allowlist. Bypass is not an OAuth skip. */
export async function allowGoogleSignIn(
  profileEmail: string | null | undefined,
): Promise<boolean> {
  const email = profileEmail?.trim().toLowerCase();
  if (!email) return false;
  return emailOnAllowlist(email);
}
