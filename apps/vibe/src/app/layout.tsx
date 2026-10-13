import type { Metadata } from "next";
import localFont from "next/font/local";

import { getVibeSiteConfig } from "@/lib/site";
import "./globals.css";
import "../sj-ui/index.css";

/** Self-hosted so Docker/CI builds do not fetch Google Fonts at compile time. */
const archivo = localFont({
  src: [
    {
      path: "../../public/fonts/Archivo-latin-400.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/Archivo-latin-600.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../public/fonts/Archivo-latin-800.woff2",
      weight: "800",
      style: "normal",
    },
  ],
  variable: "--font-archivo",
  display: "swap",
});

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
    <html lang="en" className={archivo.variable}>
      <body className={archivo.className}>{children}</body>
    </html>
  );
}
