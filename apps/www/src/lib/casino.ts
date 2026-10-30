/**
 * Optional /casino proxy config. Upstream comes only from CASINO_URL, read at
 * request time by the Route Handler (lib/casino-proxy.ts).
 * Unset or invalid → no proxy, no nav, /casino is a 404.
 */

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Origin (or origin+path prefix) to prefix `/casino` onto. Null when off. */
export function casinoUpstream(
  raw: string | null | undefined = process.env.CASINO_URL,
): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  return trimTrailingSlash(value);
}

export function isCasinoConfigured(
  raw: string | null | undefined = process.env.CASINO_URL,
): boolean {
  return casinoUpstream(raw) != null;
}

export function isCasinoPath(pathname: string): boolean {
  return pathname === "/casino" || pathname.startsWith("/casino/");
}
