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
  },
});
