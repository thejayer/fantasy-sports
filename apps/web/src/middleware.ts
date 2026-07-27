import { NextResponse } from "next/server";
import { auth } from "./auth";
import { safeCallbackUrl } from "./lib/safe-redirect";

export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const isLogin = pathname.startsWith("/login");
  const isAuthApi = pathname.startsWith("/api/auth");
  // Public probe for uptime / Cloud Monitoring — no session, no league bodies.
  const isHealth = pathname === "/api/health";
  const bypass = process.env.AUTH_DEV_BYPASS === "1";

  if (bypass || isLogin || isAuthApi || isHealth) {
    return NextResponse.next();
  }

  if (!req.auth) {
    const url = new URL("/login", req.nextUrl.origin);
    // Keep the query string so signing in returns to the exact view asked for,
    // and launder it even though it is ours -- it derives from the request.
    url.searchParams.set("callbackUrl", safeCallbackUrl(`${pathname}${search}`));
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
