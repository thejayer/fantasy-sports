import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";
import {
  effectiveAllowlist,
  parseAllowedEmailsEnv,
} from "@/lib/hub-members";

async function isEmailAllowed(email: string): Promise<boolean> {
  const envEmails = parseAllowedEmailsEnv(process.env.ALLOWED_EMAILS);
  let file = null;
  try {
    const { readHubMembers } = await import("@/lib/hub-members-store");
    file = await readHubMembers();
  } catch {
    file = null;
  }
  const allow = effectiveAllowlist(envEmails, file);
  if (allow.size === 0) {
    return false;
  }
  return allow.has(email);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ profile }) {
      if (process.env.AUTH_DEV_BYPASS === "1") {
        return true;
      }
      const email = profile?.email?.toLowerCase();
      if (!email) {
        return false;
      }
      return isEmailAllowed(email);
    },
  },
});
