import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";
import { allowGoogleSignIn } from "@/lib/auth-gate";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ profile, user }) {
      const email = profile?.email?.toLowerCase();
      const allowed = await allowGoogleSignIn(profile?.email);
      if (!allowed || !email) return false;

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
