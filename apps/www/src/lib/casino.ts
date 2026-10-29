/**
 * Optional /casino path proxy. Upstream comes only from CASINO_URL.
 * Unset or invalid → no rewrite, no nav, /casino is a 404.
 */

export type CasinoRewrite = {
  source: string;
  destination: string;
};

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

/**
 * Next.js `rewrites()` entries (afterFiles). Covers HTML and static assets
 * under /casino — middleware's matcher skips image extensions, so the
 * rewrite is what forwards `/casino/*.png` (accepted soft gate).
 */
export function casinoRewrites(
  raw: string | null | undefined = process.env.CASINO_URL,
): CasinoRewrite[] {
  const upstream = casinoUpstream(raw);
  if (!upstream) return [];
  return [
    { source: "/casino", destination: `${upstream}/casino` },
    { source: "/casino/:path*", destination: `${upstream}/casino/:path*` },
  ];
}
