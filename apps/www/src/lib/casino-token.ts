/**
 * Google ID token for the private sj-casino Cloud Run service.
 *
 * sj-www asks the metadata server for an identity token (audience = the
 * casino origin) and sends it upstream as `Authorization: Bearer`. Tokens
 * are cached in memory until REFRESH_MARGIN_MS before their `exp`. Off Cloud
 * Run (no metadata server) the result is null and no token is sent.
 */

export const METADATA_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

/** Refresh this long before the token's `exp`. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** After a failed metadata call, don't retry for this long. */
export const FAILURE_BACKOFF_MS = 30 * 1000;
const METADATA_TIMEOUT_MS = 2_000;
/** Used when a token has no readable `exp` (cached for about 5 minutes). */
const UNKNOWN_EXP_TTL_MS = 10 * 60 * 1000;

type CacheEntry = { token: string; expiresAtMs: number };

const cache = new Map<string, CacheEntry>();
const failedUntil = new Map<string, number>();
const inflight = new Map<string, Promise<string | null>>();

export type TokenDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  metadataUrl?: string;
};

/** `exp` of a JWT in epoch ms, or null if it can't be read. */
export function jwtExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function clearCasinoTokenCache(): void {
  cache.clear();
  failedUntil.clear();
  inflight.clear();
}

async function fetchToken(
  audience: string,
  deps: Required<TokenDeps>,
): Promise<string | null> {
  const url = `${deps.metadataUrl}?${new URLSearchParams({ audience }).toString()}`;
  try {
    const res = await deps.fetchImpl(url, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`metadata status ${res.status}`);
    const token = (await res.text()).trim();
    if (!token) throw new Error("empty token");
    const now = deps.now();
    cache.set(audience, {
      token,
      expiresAtMs: jwtExpiryMs(token) ?? now + UNKNOWN_EXP_TTL_MS,
    });
    failedUntil.delete(audience);
    return token;
  } catch {
    failedUntil.set(audience, deps.now() + FAILURE_BACKOFF_MS);
    return null;
  }
}

/**
 * ID token for `audience`, or null when the metadata server is unreachable.
 * Concurrent callers share one metadata request.
 */
export async function getCasinoIdToken(
  audience: string,
  deps: TokenDeps = {},
): Promise<string | null> {
  const resolved: Required<TokenDeps> = {
    fetchImpl: deps.fetchImpl ?? fetch,
    now: deps.now ?? Date.now,
    metadataUrl: deps.metadataUrl ?? METADATA_IDENTITY_URL,
  };
  const now = resolved.now();

  const hit = cache.get(audience);
  if (hit && now < hit.expiresAtMs - REFRESH_MARGIN_MS) return hit.token;

  const blockedUntil = failedUntil.get(audience);
  if (blockedUntil !== undefined && now < blockedUntil) return null;

  const pending = inflight.get(audience);
  if (pending) return pending;

  const request = fetchToken(audience, resolved).finally(() => {
    inflight.delete(audience);
  });
  inflight.set(audience, request);
  return request;
}
