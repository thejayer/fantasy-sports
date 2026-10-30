/**
 * Signed-out handling for /casino/**. Pure and edge-safe: imported by
 * middleware.ts and by the Route Handler's proxy.
 *
 * Page navigations bounce to /login?callbackUrl=<path+query>; everything else
 * (images, scripts, fetch/XHR, non-GET) gets a bare 401 so an <img> or fetch()
 * never receives the HTML sign-in page.
 */

import { safeCallbackUrl } from "@/lib/safe-redirect";

const FILE_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;

/** True for a browser page load that should be sent to the sign-in page. */
export function isCasinoNavigation(
  method: string,
  pathname: string,
  headers: Headers,
): boolean {
  const verb = method.toUpperCase();
  if (verb !== "GET" && verb !== "HEAD") return false;

  const lastSegment = pathname.split("/").pop() ?? "";
  if (FILE_EXTENSION.test(lastSegment)) return false;

  const dest = headers.get("sec-fetch-dest");
  if (dest) return dest === "document" || dest === "iframe" || dest === "frame";

  const accept = headers.get("accept");
  if (!accept) return true;
  return /text\/html|\*\/\*/i.test(accept);
}

/**
 * Redirect to the sign-in page, carrying the original path + query. The
 * Location is relative (fine from a Route Handler); middleware must pass an
 * `origin` because Next requires absolute URLs there.
 */
export function casinoLoginRedirect(
  pathname: string,
  search: string,
  origin?: string,
): Response {
  const target = new URLSearchParams({
    callbackUrl: safeCallbackUrl(`${pathname}${search}`),
  });
  return new Response(null, {
    status: 307,
    headers: {
      location: `${origin ?? ""}/login?${target.toString()}`,
      "cache-control": "no-store",
    },
  });
}

export function casinoUnauthorized(): Response {
  return new Response("Sign in to Strictly Jayers to use the casino.", {
    status: 401,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** The response for a signed-out request under /casino. */
export function casinoSignedOutResponse(
  request: Request,
  options: { absolute?: boolean } = {},
): Response {
  const url = new URL(request.url);
  if (isCasinoNavigation(request.method, url.pathname, request.headers)) {
    return casinoLoginRedirect(
      url.pathname,
      url.search,
      options.absolute ? url.origin : undefined,
    );
  }
  return casinoUnauthorized();
}
