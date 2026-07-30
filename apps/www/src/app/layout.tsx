import type { Metadata } from "next";
import { Figtree, Syne } from "next/font/google";
import Link from "next/link";

import { getSiteConfig } from "@/lib/site";
import "./globals.css";

const display = Syne({
  variable: "--font-display-face",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const body = Figtree({
  variable: "--font-body-face",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const siteDescription =
  "Home for the Strictly Jayers community — Discord, games, and the fantasy hub.";

export function generateMetadata(): Metadata {
  const { siteUrl } = getSiteConfig();
  return {
    metadataBase: new URL(siteUrl),
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
      url: siteUrl,
    },
    twitter: {
      card: "summary_large_image",
      title: "Strictly Jayers",
      description: siteDescription,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { fantasyHubUrl, discordInviteUrl } = getSiteConfig();

  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>
        <div className="atmosphere" aria-hidden />
        <div className="shell">
          <header className="site-header">
            <Link href="/" className="brand-mark">
              Strictly Jayers
            </Link>
            <nav className="nav-links" aria-label="Primary">
              <a href="#destinations">Places</a>
              {discordInviteUrl ? (
                <a href={discordInviteUrl} rel="noopener noreferrer">
                  Discord
                </a>
              ) : null}
              <a href={fantasyHubUrl} rel="noopener noreferrer">
                Fantasy
              </a>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
