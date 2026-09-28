import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  apexRedirectUrl,
  shouldRedirectWwwToApex,
} from "@/lib/apex-host";

/**
 * Roadmap P.3 — keep the apex as the canonical host.
 * www is mapped to sj-www in DNS; this 308 consolidates the URL bar + cookies.
 * Do not rename to proxy.ts (Node-only); keep Edge-compatible like the hub.
 */
export function middleware(request: NextRequest) {
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
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)",
  ],
};
