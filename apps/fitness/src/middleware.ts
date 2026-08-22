import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { authConfig } from "@/auth.config";
import { safeCallbackUrl } from "@/lib/safe-redirect";

const { auth } = NextAuth(authConfig);

function isPublicPath(pathname: string): boolean {
  if (pathname === "/api/health") return true;
  if (pathname.startsWith("/login")) return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname.startsWith("/fonts/")) return true;
  return false;
}

function rewriteAppHome(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/" || pathname === "/index.html") {
    return NextResponse.rewrite(new URL("/app.html", request.url));
  }
  return NextResponse.next();
}

/**
 * Members-only training log. Guests hit the sign-in wall — they must not see
 * another member's cached athleteLog.* on a shared computer.
 */
export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const bypass = process.env.AUTH_DEV_BYPASS === "1";

  // API handlers return JSON (401/409). A login HTML redirect would break
  // the PWA sync fetch and hide isolation failures.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (bypass || isPublicPath(pathname)) {
    return rewriteAppHome(req);
  }

  if (!req.auth) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", safeCallbackUrl(`${pathname}${search}`));
    return NextResponse.redirect(url);
  }

  return rewriteAppHome(req);
});

export const config = {
  matcher: [
    "/((?!api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)",
  ],
};
