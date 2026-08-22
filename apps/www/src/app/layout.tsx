import Link from "next/link";

import { PortalNav } from "@/components/PortalNav";
import { ACCENT_INIT_SCRIPT } from "@/components/AccentPicker";
import { portalCopy } from "@/lib/content";
import { getSiteConfig } from "@/lib/site";
import localFont from "next/font/local";
import type { Metadata } from "next";
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
  const { fantasyHubUrl, fitnessUrl, discordInviteUrl } = getSiteConfig();

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
            <PortalNav
              fantasyHubUrl={fantasyHubUrl}
              fitnessUrl={fitnessUrl}
              discordInviteUrl={discordInviteUrl}
            />
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
