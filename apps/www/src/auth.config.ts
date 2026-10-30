import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Edge-safe Auth.js config (middleware).
 * Node-only callbacks (members-file allowlist) live in `auth.ts`.
 *
 * Same Google client + allowlist as `apps/web` — one SJ identity.
 * Cookies stay on the apex (strictlyjayers.com). /bets is gated; /casino
 * is gated too when CASINO_URL is set.
 */
export const authConfig = {
  providers: [Google],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  trustHost: true,
  callbacks: {
    authorized() {
      // middleware.ts owns the redirect; keep the callback permissive.
      return true;
    },
  },
} satisfies NextAuthConfig;
