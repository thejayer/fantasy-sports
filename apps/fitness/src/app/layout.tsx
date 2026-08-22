import type { Metadata } from "next";

import { getFitnessSiteConfig } from "@/lib/site";
import "./globals.css";

export function generateMetadata(): Metadata {
  const { siteUrl } = getFitnessSiteConfig();
  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: "Fitness · Strictly Jayers",
      template: "%s · Strictly Jayers",
    },
    description:
      "Strictly Jayers training log — golf, tennis, pickleball, lifting, and endurance. Local-first, installable, offline.",
    applicationName: "Strictly Jayers",
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
