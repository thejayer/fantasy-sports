import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/auth.config";
import { isPublicMetadataPath } from "@/lib/public-metadata";
import { safeCallbackUrl } from "@/lib/safe-redirect";

const { auth } = NextAuth(authConfig);

function isPublicPath(pathname: string): boolean {
  if (pathname === "/api/health") return true;
  if (pathname.startsWith("/login")) return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname.startsWith("/api/ingest/")) return true;
  if (pathname === "/api/github/callback") return true;
  if (pathname === "/api/cron/sync") return true;
  if (pathname.startsWith("/fonts/")) return true;
  if (isPublicMetadataPath(pathname)) return true;
  return false;
}

/**
 * Members-only vibe log. Guests hit the sign-in wall.
 */
export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const bypass = process.env.AUTH_DEV_BYPASS === "1";

  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (bypass || isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!req.auth) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", safeCallbackUrl(`${pathname}${search}`));
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api/health|_next/static|_next/image|favicon.ico|icon(?:/|$)|apple-icon|opengraph-image|twitter-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)",
  ],
};
