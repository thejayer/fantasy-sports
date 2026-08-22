/**
 * Sign-in allowlist — same rule as the fantasy hub.
 * Allow = ALLOWED_EMAILS ∪ hub_members.json emails. No second directory.
 */

export type MembersFile = {
  members: Array<{ email?: string | null }>;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseAllowedEmailsEnv(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter(Boolean);
}

/** Sign-in allowlist = env emails ∪ persisted member emails. */
export function effectiveAllowlist(
  envEmails: string[],
  file: MembersFile | null,
): Set<string> {
  const allow = new Set(envEmails);
  for (const member of file?.members ?? []) {
    if (member.email) allow.add(normalizeEmail(member.email));
  }
  return allow;
}

export function isEmailAllowed(
  email: string,
  envEmails: string[],
  file: MembersFile | null,
): boolean {
  const allow = effectiveAllowlist(envEmails, file);
  if (allow.size === 0) return false;
  return allow.has(normalizeEmail(email));
}
