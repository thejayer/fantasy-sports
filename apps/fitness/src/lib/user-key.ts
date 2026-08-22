import { createHash } from "crypto";

import { normalizeEmail } from "@/lib/allowlist";

/** Filesystem-safe id derived from the allowlisted email. Never trust a client id. */
export function userKeyFromEmail(email: string): string {
  return createHash("sha256")
    .update(normalizeEmail(email))
    .digest("hex")
    .slice(0, 32);
}

/** localStorage / IndexedDB prefix for this member. */
export function storagePrefixForEmail(email: string): string {
  return `athleteLog.${userKeyFromEmail(email)}`;
}
