/**
 * Apex host helpers for Cloud Run custom domains (roadmap P.3).
 * Prefer SITE_URL as the canonical origin; send www → apex.
 */

export function preferredHostFromSiteUrl(siteUrl: string): string | null {
  try {
    const url = new URL(siteUrl);
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host === "127.0.0.1") return null;
    if (host.endsWith(".run.app")) return null;
    return host;
  } catch {
    return null;
  }
}

/** True when request Host is www.<preferred> and should 308 to SITE_URL. */
export function shouldRedirectWwwToApex(
  requestHost: string | null | undefined,
  siteUrl: string,
): boolean {
  const preferred = preferredHostFromSiteUrl(siteUrl);
  if (!preferred) return false;
  const host = requestHost?.split(":")[0]?.toLowerCase() ?? "";
  if (!host || host === preferred) return false;
  return host === `www.${preferred}`;
}

export function apexRedirectUrl(
  siteUrl: string,
  pathname: string,
  search = "",
): string {
  const base = siteUrl.replace(/\/+$/, "");
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${base}${path}${search}`;
}
