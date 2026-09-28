import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { ACCENT_INIT_SCRIPT } from "@/components/AccentPicker";
import { MemberAvatar } from "@/components/MemberAvatar";
import { MobileNav } from "@/components/MobileNav";
import { THEME_INIT_SCRIPT } from "@/components/ThemeToggle";
import {
  canAccessAdmin,
  findMember,
  parseAllowedEmailsEnv,
} from "@/lib/hub-members";
import { readHubMembers } from "@/lib/hub-members-store";
import { devBypassEnabled } from "@/lib/session";
import "./globals.css";

/** Self-hosted so Docker/CI builds do not fetch Google Fonts at compile time. */
const archivo = localFont({
  src: [
    {
      path: "../fonts/Archivo-latin-400.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/Archivo-latin-600.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../fonts/Archivo-latin-800.woff2",
      weight: "800",
      style: "normal",
    },
  ],
  variable: "--font-archivo",
  display: "swap",
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
  let membersFile = null as Awaited<ReturnType<typeof readHubMembers>> | null;
  if (!showAdmin && session?.user?.email) {
    try {
      membersFile = await readHubMembers();
      showAdmin = canAccessAdmin(session.user.email, membersFile, {
        envAllowlist: parseAllowedEmailsEnv(process.env.ALLOWED_EMAILS),
        adminEmailsEnv: parseAllowedEmailsEnv(process.env.ADMIN_EMAILS),
      });
    } catch {
      showAdmin = false;
    }
  }

  const profileLabel = session?.user
    ? (session.user.name ?? session.user.email ?? "Profile")
    : bypass
      ? "Profile"
      : null;
  const memberRow =
    session?.user?.email && membersFile
      ? findMember(membersFile, session.user.email)
      : undefined;
  const profileImage =
    memberRow?.image_url?.trim() ||
    session?.user?.image?.trim() ||
    null;
  const communityUrl =
    process.env.COMMUNITY_SITE_URL?.replace(/\/$/, "") ||
    "https://strictlyjayers.com";

  return (
    <html lang="en" className={archivo.variable} suppressHydrationWarning>
      <head>
        {/* Applies a saved theme override before first paint (roadmap 7.10). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: ACCENT_INIT_SCRIPT }} />
      </head>
      <body>
        <div className="atmosphere" aria-hidden />
        <div className="shell">
          <header className="site-header">
            <Link href="/" className="brand-mark">
              Strictly Jayers
            </Link>
            <nav className="nav-links">
              <Link href="/">Home</Link>
              <Link href="/leagues">Leagues</Link>
              <a href={communityUrl} rel="noopener noreferrer">
                Community
              </a>
              {showAdmin ? <Link href="/admin">Admin</Link> : null}
              {profileLabel ? (
                <>
                  <Link
                    href="/settings"
                    className="nav-user"
                    title={session?.user?.email ?? "Profile & appearance"}
                  >
                    <MemberAvatar
                      name={profileLabel}
                      imageUrl={profileImage}
                      size="sm"
                    />
                    <span className="nav-user-label">{profileLabel}</span>
                  </Link>
                  {session?.user ? (
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
                  ) : null}
                </>
              ) : null}
            </nav>
          </header>
          {children}
        </div>
        <MobileNav
          showAdmin={showAdmin}
          showProfile={Boolean(profileLabel)}
          communityUrl={communityUrl}
        />
      </body>
    </html>
  );
}
