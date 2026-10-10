import type { Metadata } from "next";

import { getVibeSiteConfig } from "@/lib/site";
import "./globals.css";

export function generateMetadata(): Metadata {
  const { siteUrl } = getVibeSiteConfig();
  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: "Vibe Split · Strictly Jayers",
      template: "%s · Vibe Split",
    },
    description:
      "How much Austin coded while he was lifting — workouts overlapped with GitHub.",
    applicationName: "Vibe Split",
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
