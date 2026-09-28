import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Edge-safe Auth.js config (middleware).
 * Node-only callbacks (members-file allowlist) live in `auth.ts`.
 *
 * Same Google client + allowlist as `apps/web` — one SJ identity, not a
 * second user directory. Cookies stay on this origin (fitness host).
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
