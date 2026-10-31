/**
 * True when a state-changing request really came from one of our own pages:
 * its Origin is this site (or the request's own origin), or, with no Origin,
 * the browser says Sec-Fetch-Site is same-origin. A cross-site form post
 * always carries a foreign Origin, so it never passes.
 */
export function isSameOriginRequest(request: Request, siteUrl: string): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    const allowed = new Set<string>();
    for (const base of [siteUrl, request.url]) {
      try {
        allowed.add(new URL(base).origin);
      } catch {
        // ignore an unparseable base
      }
    }
    return allowed.has(origin);
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}
