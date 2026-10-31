import Link from "next/link";

import { ACCENT_INIT_SCRIPT } from "@/components/AccentPicker";
import { AvatarMenu } from "@/components/AvatarMenu";
import { SHARED_THEME_INIT_SCRIPT } from "@/components/SideProfile";
import { portalCopy } from "@/lib/content";
import { getSiteConfig } from "@/lib/site";
import { AppSwitcher } from "@/components/AppSwitcher";
import { SideNav } from "@/components/SideNav";
import localFont from "next/font/local";
import type { Metadata } from "next";
import "./globals.css";
import "./account.css";
import "../sj-ui/index.css";

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
  const {
    fantasyHubUrl,
    fitnessUrl,
    vibeUrl,
    siteUrl,
    discordInviteUrl,
    casinoEnabled,
  } = getSiteConfig();

  return (
    <html lang="en" className={archivo.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: ACCENT_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SHARED_THEME_INIT_SCRIPT }} />
      </head>
      <body className={archivo.className}>
        <div className="shell">
          <header className="site-header sj-side">
            <Link href="/" className="brand-mark">
              Strictly Jayers
            </Link>
            <div className="sj-side-group sj-side-group-apps">
              <p className="sj-side-label">Apps</p>
              <AppSwitcher
                hubUrl={fantasyHubUrl}
                betsUrl={`${siteUrl}/bets`}
                fitnessUrl={fitnessUrl}
                vibeUrl={vibeUrl}
              />
            </div>
            <SideNav
              label="Strictly Jayers"
              items={[
                { label: "Home", href: "/" },
                { label: "Fantasy", href: fantasyHubUrl, external: true },
                discordInviteUrl
                  ? { label: "Discord", href: discordInviteUrl, external: true }
                  : { label: "Discord", href: "/#destinations", external: true },
              ]}
            />
            <SideNav
              label="More"
              items={[
                { label: "Places", href: "/#destinations", external: true },
                { label: "AI News", href: "/ai" },
                { label: "People", href: "/people" },
                { label: "Watch", href: "/watch" },
                { label: "Palworld", href: "/palworld" },
                ...(casinoEnabled
                  ? [{ label: "Casino", href: "/casino", anchor: true }]
                  : []),
              ]}
            />
            <div className="sj-side-foot">
              <AvatarMenu />
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
