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
    async signIn({ profile, user }) {
      if (process.env.AUTH_DEV_BYPASS === "1") {
        return true;
      }
      const email = profile?.email?.toLowerCase();
      if (!email) {
        return false;
      }
      const allowed = await isEmailAllowed(email);
      if (!allowed) return false;

      // Best-effort avatar sync for feed / chrome (roadmap 7.10b).
      const picture =
        (typeof user?.image === "string" && user.image.trim()) ||
        (typeof (profile as { picture?: unknown })?.picture === "string"
          ? String((profile as { picture: string }).picture).trim()
          : "");
      if (picture.startsWith("https://")) {
        try {
          const { setMemberImageUrl } = await import("@/lib/hub-members");
          const { updateHubMembers } = await import(
            "@/lib/hub-members-store"
          );
          await updateHubMembers((file) => {
            const next = setMemberImageUrl(file, email, picture);
            return next;
          });
        } catch {
          // Allowlist already passed; avatar write must not block sign-in.
        }
      }
      return true;
    },
  },
});
