/**
 * Google sign-in allowlist. AUTH_DEV_BYPASS never skips a real OAuth profile.
 */

import {
  effectiveAllowlist,
  parseAllowedEmailsEnv,
} from "@/lib/hub-members";

export async function allowGoogleSignIn(
  profileEmail: string | null | undefined,
): Promise<boolean> {
  const email = profileEmail?.trim().toLowerCase();
  if (!email) return false;
  const envEmails = parseAllowedEmailsEnv(process.env.ALLOWED_EMAILS);
  let file = null;
  try {
    const { readHubMembers } = await import("@/lib/hub-members-store");
    file = await readHubMembers();
  } catch {
    file = null;
  }
  const allow = effectiveAllowlist(envEmails, file);
  if (allow.size === 0) return false;
  return allow.has(email);
}
