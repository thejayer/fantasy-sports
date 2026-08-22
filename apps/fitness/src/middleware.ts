import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Serve the local-first training log at `/` so the PWA shell and service
 * worker stay on the fitness origin (not the apex portal).
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/" || pathname === "/index.html") {
    return NextResponse.rewrite(new URL("/app.html", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/index.html"],
};
