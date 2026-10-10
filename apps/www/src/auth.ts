import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";
import {
  isEmailAllowed,
  parseAllowedEmailsEnv,
} from "@/lib/allowlist";

async function emailOnAllowlist(email: string): Promise<boolean> {
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
      return emailOnAllowlist(email);
    },
  },
});
