import type { Metadata } from "next";
import { Syne, Source_Sans_3 } from "next/font/google";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { MobileNav } from "@/components/MobileNav";
import { THEME_INIT_SCRIPT, ThemeToggle } from "@/components/ThemeToggle";
import {
  canAccessAdmin,
  parseAllowedEmailsEnv,
} from "@/lib/hub-members";
import { readHubMembers } from "@/lib/hub-members-store";
import { devBypassEnabled } from "@/lib/session";
import "./globals.css";

const display = Syne({
  variable: "--font-display-face",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const body = Source_Sans_3({
  variable: "--font-body-face",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const siteDescription = "Fantasy leagues and member hub for Strictly Jayers.";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.AUTH_URL?.replace(/\/$/, "") || "http://localhost:3000",
  ),
  title: {
    default: "Strictly Jayers",
    template: "%s · Strictly Jayers",
  },
  description: siteDescription,
  applicationName: "Strictly Jayers",
  openGraph: {
    title: "Strictly Jayers",
    description: siteDescription,
    siteName: "Strictly Jayers",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Strictly Jayers",
    description: siteDescription,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const bypass = devBypassEnabled();
  const session = bypass ? null : await auth();
  let showAdmin = bypass;
  if (!showAdmin && session?.user?.email) {
    try {
      const file = await readHubMembers();
      showAdmin = canAccessAdmin(session.user.email, file, {
        envAllowlist: parseAllowedEmailsEnv(process.env.ALLOWED_EMAILS),
        adminEmailsEnv: parseAllowedEmailsEnv(process.env.ADMIN_EMAILS),
      });
    } catch {
      showAdmin = false;
    }
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies a saved theme override before first paint (roadmap 7.10). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${display.variable} ${body.variable}`}>
        <div className="atmosphere" aria-hidden />
        <div className="shell">
          <header className="site-header">
            <Link href="/" className="brand-mark">
              Strictly Jayers
            </Link>
            <nav className="nav-links">
              <Link href="/leagues">Leagues</Link>
              {showAdmin ? <Link href="/admin">Admin</Link> : null}
              <ThemeToggle />
              {session?.user ? (
                <>
                  <span className="nav-user" title={session.user.email ?? undefined}>
                    {session.user.name ?? session.user.email}
                  </span>
                  <form
                    action={async () => {
                      "use server";
                      await signOut({ redirectTo: "/login" });
                    }}
                  >
                    <button className="button secondary" type="submit">
                      Sign out
                    </button>
                  </form>
                </>
              ) : null}
            </nav>
          </header>
          {children}
        </div>
        <MobileNav showAdmin={showAdmin} />
      </body>
    </html>
  );
}
