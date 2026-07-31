import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import Link from "next/link";

import {
  ACCENT_INIT_SCRIPT,
  AccentPicker,
} from "@/components/AccentPicker";
import { portalCopy } from "@/lib/content";
import { getSiteConfig } from "@/lib/site";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "600", "800"],
  variable: "--font-archivo",
});

export function generateMetadata(): Metadata {
  const { siteUrl } = getSiteConfig();
  const siteDescription = portalCopy.metaDescription;
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
    <html lang="en" className={archivo.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: ACCENT_INIT_SCRIPT }} />
      </head>
      <body style={{ fontFamily: "var(--font-archivo), var(--font-body)" }}>
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
              ) : (
                <a href="#destinations">Discord</a>
              )}
              <a href={fantasyHubUrl} rel="noopener noreferrer">
                Fantasy
              </a>
              <AccentPicker />
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
