import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";
import { allowGoogleSignIn } from "@/lib/auth-gate";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ profile }) {
      return allowGoogleSignIn(profile?.email);
    },
    // Expose the stable Google subject so /casino can derive an opaque member
    // id (hashed in casino-identity.ts; never sent upstream as-is).
    session({ session, token }) {
      if (token.sub && session.user) {
        (session.user as { id?: string }).id = token.sub;
      }
      return session;
    },
  },
});
