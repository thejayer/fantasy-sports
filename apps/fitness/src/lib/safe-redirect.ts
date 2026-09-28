/**
 * Validation for user-supplied post-login redirect targets.
 * Same rules as the fantasy hub — never bounce a member off this origin.
 */

export const DEFAULT_CALLBACK_URL = "/";

const PROBE_ORIGIN = "http://redirect-probe.invalid";
const BROWSER_STRIPPED = /[\t\r\n]/g;
const DISALLOWED = /[\s\u0000-\u001f\u007f]/;

export function safeCallbackUrl(
  raw: string | null | undefined,
  fallback: string = DEFAULT_CALLBACK_URL,
): string {
  if (!raw) {
    return fallback;
  }

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

  if (resolved.origin !== PROBE_ORIGIN) {
    return fallback;
  }

  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
