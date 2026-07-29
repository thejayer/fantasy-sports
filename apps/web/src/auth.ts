import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import {
  effectiveAllowlist,
  parseAllowedEmailsEnv,
} from "@/lib/hub-members";

async function isEmailAllowed(email: string): Promise<boolean> {
  const envEmails = parseAllowedEmailsEnv(process.env.ALLOWED_EMAILS);
  let file = null;
  try {
    // Dynamic import keeps Node `fs` out of the Edge middleware bundle
    // (middleware imports this module for session decrypt only).
    const { readHubMembers } = await import("@/lib/hub-members-store");
    file = await readHubMembers();
  } catch {
    // Fail closed to env-only if the members file is unreadable.
    file = null;
  }
  const allow = effectiveAllowlist(envEmails, file);
  if (allow.size === 0) {
    // Fail closed when both env and members are empty in real auth mode.
    return false;
  }
  return allow.has(email);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
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
  trustHost: true,
});
