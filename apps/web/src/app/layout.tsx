import type { Metadata } from "next";
import { Syne, Source_Sans_3 } from "next/font/google";
import Link from "next/link";
import { auth, signOut } from "@/auth";
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
  const session = process.env.AUTH_DEV_BYPASS === "1" ? null : await auth();

  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>
        <div className="atmosphere" aria-hidden />
        <div className="shell">
          <header className="site-header">
            <Link href="/" className="brand-mark">
              Strictly Jayers
            </Link>
            <nav className="nav-links">
              <Link href="/leagues">Leagues</Link>
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
      </body>
    </html>
  );
}
