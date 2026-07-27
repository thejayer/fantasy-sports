/**
 * Validation for user-supplied post-login redirect targets.
 *
 * `callbackUrl` arrives from the query string, so passing it straight to
 * `redirect()` lets an attacker bounce a signed-in member off our origin --
 * a phishing setup that borrows our domain's credibility. Everything that
 * consumes a caller-supplied redirect target must launder it through
 * `safeCallbackUrl` first.
 */

export const DEFAULT_CALLBACK_URL = "/";

/**
 * Arbitrary origin used only to resolve relative paths. Any candidate that
 * resolves to a *different* origin is trying to leave the site.
 */
const PROBE_ORIGIN = "http://redirect-probe.invalid";

/** Tab/CR/LF are stripped by browsers before a URL is resolved. */
const BROWSER_STRIPPED = /[\t\r\n]/g;

/** C0 controls, DEL, and any whitespace that survived stripping. */
const DISALLOWED = /[\s\u0000-\u001f\u007f]/;

/**
 * Reduce a caller-supplied `callbackUrl` to a same-origin path.
 *
 * Returns `fallback` for anything that is not a rooted, same-origin path:
 * absolute URLs, protocol-relative `//host`, backslash variants the URL
 * parser normalises into an authority, and non-http schemes.
 */
export function safeCallbackUrl(
  raw: string | null | undefined,
  fallback: string = DEFAULT_CALLBACK_URL,
): string {
  if (!raw) {
    return fallback;
  }

  // Strip first, then validate: "/\tevil.com" reaches the browser as
  // "//evil.com", so validating the unstripped string would pass it.
  const candidate = raw.replace(BROWSER_STRIPPED, "");

  if (!candidate.startsWith("/") || DISALLOWED.test(candidate)) {
    return fallback;
  }

  let resolved: URL;
  try {
    resolved = new URL(candidate, PROBE_ORIGIN);
  } catch {
    return fallback;
  }

  // Catches "//host" and "/\host" -- the WHATWG parser treats a backslash in
  // a special scheme as a separator, so "/\host" becomes an authority.
  if (resolved.origin !== PROBE_ORIGIN) {
    return fallback;
  }

  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
