import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { authConfig } from "@/auth.config";
import {
  apexRedirectUrl,
  shouldRedirectWwwToApex,
} from "@/lib/apex-host";
import { isMembersProtectedPath } from "@/lib/bets-gate";
import { safeCallbackUrl } from "@/lib/safe-redirect";

const { auth } = NextAuth(authConfig);

function apexRedirect(request: NextRequest): NextResponse | null {
  const siteUrl = process.env.SITE_URL?.trim() || "";
  const host = request.headers.get("host");
  if (siteUrl && shouldRedirectWwwToApex(host, siteUrl)) {
    const target = apexRedirectUrl(
      siteUrl,
      request.nextUrl.pathname,
      request.nextUrl.search,
    );
    return NextResponse.redirect(target, 308);
  }
  return null;
}

/**
 * Auth.js on /bets (and /api/bets) plus /casino when CASINO_URL is set.
 * Public apex routes never construct a session so sj-www stays up before
 * AUTH_SECRET is mounted. Image extensions skip this matcher — /casino
 * assets still proxy via next.config rewrites (soft gate).
 */
const withBetsAuth = auth((request) => {
  if (process.env.AUTH_DEV_BYPASS === "1") {
    return NextResponse.next();
  }
  if (!request.auth) {
    const url = new URL("/login", request.nextUrl.origin);
    url.searchParams.set(
      "callbackUrl",
      safeCallbackUrl(`${request.nextUrl.pathname}${request.nextUrl.search}`),
    );
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export default function middleware(request: NextRequest) {
  const redirected = apexRedirect(request);
  if (redirected) return redirected;
  if (!isMembersProtectedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
  // next-auth types this wrapper as an App Route handler (req + ctx).
  return withBetsAuth(request, { params: Promise.resolve({}) });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)",
  ],
};
