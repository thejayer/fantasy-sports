import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

function allowedEmails(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
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
      const allow = allowedEmails();
      if (allow.size === 0) {
        // Fail closed when allowlist is empty in real auth mode.
        return false;
      }
      return allow.has(email);
    },
  },
  trustHost: true,
});
