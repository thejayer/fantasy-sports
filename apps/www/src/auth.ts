import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";
import { allowGoogleSignIn } from "@/lib/auth-gate";
import { withGoogleSub } from "@/lib/casino-identity";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ profile }) {
      return allowGoogleSignIn(profile?.email);
    },
    // Without a database adapter Auth.js sets token.sub to a random UUID on
    // every sign-in, so keep the Google subject (stable) on the token at
    // sign-in (when `account` is present). Later calls just return the token.
    jwt({ token, account }) {
      return withGoogleSub(token, account);
    },
    // Expose the ids /casino needs to derive an opaque member id (hashed in
    // casino-identity.ts; never sent upstream as-is).
    session({ session, token }) {
      if (session.user) {
        const user = session.user as { id?: string; googleSub?: string };
        if (token.sub) user.id = token.sub;
        if (typeof token.googleSub === "string") user.googleSub = token.googleSub;
      }
      return session;
    },
  },
});
