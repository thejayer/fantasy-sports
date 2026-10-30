/**
 * Authenticated /casino reverse proxy (used by app/casino/[[...path]]/route.ts).
 *
 * Signed-in Strictly Jayers members only. The portal calls the private
 * sj-casino Cloud Run service with its own Google ID token; the browser's
 * Cookie / Authorization headers never reach the casino. The signed-in
 * member's opaque id and display name ride along as `x-sj-*` headers (client
 * supplied `x-sj-*` headers are always stripped first).
 */

import { casinoUpstream } from "@/lib/casino";
import { casinoSignedOutResponse } from "@/lib/casino-gate";
import {
  SJ_HEADER_PREFIX,
  casinoIdentityHeaders,
  type CasinoMember,
  type IdentityEnv,
} from "@/lib/casino-identity";
import { getCasinoIdToken } from "@/lib/casino-token";

export const CASINO_BASE_PATH = "/casino";
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Never forwarded upstream (identity, hop-by-hop, and framing headers). */
const BLOCKED_REQUEST_HEADERS = new Set([
  "cookie",
  "authorization",
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "accept-encoding",
  "expect",
]);

const BLOCKED_REQUEST_PREFIXES = [
  "x-middleware-",
  "x-nextjs-",
  "x-vercel-",
  // Identity headers are set by the portal only; never trust the browser's.
  SJ_HEADER_PREFIX,
];

/** The only upstream response headers handed to the browser. */
const PASSTHROUGH_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  "expires",
  "vary",
  "content-language",
  "content-disposition",
  // Lets a chat client back off after a 429.
  "retry-after",
];

/** Dynamic casino API (chat polling, state): never cache. */
const API_PREFIX = `${CASINO_BASE_PATH}/api`;

export function isCasinoApiPath(pathname: string): boolean {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

export function filterRequestHeaders(incoming: Headers): Headers {
  const out = new Headers();
  incoming.forEach((value, name) => {
    const key = name.toLowerCase();
    if (BLOCKED_REQUEST_HEADERS.has(key)) return;
    if (BLOCKED_REQUEST_PREFIXES.some((prefix) => key.startsWith(prefix))) return;
    out.append(name, value);
  });
  return out;
}

/** Relative path when `location` points at the casino origin, else unchanged. */
export function rewriteLocation(location: string, upstreamOrigin: string): string {
  try {
    const parsed = new URL(location, upstreamOrigin);
    if (parsed.origin === upstreamOrigin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Unparseable: pass through untouched.
  }
  return location;
}

export function filterResponseHeaders(
  upstream: Headers,
  upstreamOrigin: string,
): Headers {
  const out = new Headers();
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
    const value = upstream.get(name);
    if (value !== null) out.set(name, value);
  }
  for (const cookie of upstream.getSetCookie()) {
    out.append("set-cookie", cookie);
  }
  const location = upstream.get("location");
  if (location !== null) {
    out.set("location", rewriteLocation(location, upstreamOrigin));
  }
  return out;
}

export type CasinoProxyDeps = {
  /** Defaults to `casinoUpstream()` (CASINO_URL, read at request time). */
  upstream?: string | null;
  /**
   * The signed-in member (Auth.js session shared with /bets), or null when
   * signed out.
   */
  getMember: () => Promise<CasinoMember | null>;
  /** Defaults to process.env (CASINO_USER_ID_SALT). */
  env?: IdentityEnv;
  /** "none" skips the ID token (tests). Defaults to process.env.CASINO_AUTH. */
  authMode?: string | undefined;
  getToken?: (audience: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /**
   * Extra `x-sj-*` headers set by the portal's own server code (never taken
   * from the browser: every client `x-sj-*` header is stripped first). Used
   * to mark the portal's own calls to the casino's private grant endpoints.
   */
  serviceHeaders?: Record<string, string>;
};

function notFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function upstreamUrl(base: string, request: Request): URL | null {
  const incoming = new URL(request.url);
  const rest = incoming.pathname.slice(CASINO_BASE_PATH.length);
  const target = new URL(`${base}${CASINO_BASE_PATH}${rest}${incoming.search}`);
  // Never let a crafted path leave the configured casino origin.
  return target.origin === new URL(base).origin ? target : null;
}

export async function proxyCasino(
  request: Request,
  deps: CasinoProxyDeps,
): Promise<Response> {
  const base = deps.upstream === undefined ? casinoUpstream() : deps.upstream;
  if (!base) return notFound();

  const member = await deps.getMember();
  if (!member) return casinoSignedOutResponse(request);

  const target = upstreamUrl(base, request);
  if (!target) return notFound();

  const headers = filterRequestHeaders(request.headers);
  const identity = casinoIdentityHeaders(member, deps.env ?? process.env);
  for (const [name, value] of Object.entries(identity)) headers.set(name, value);
  for (const [name, value] of Object.entries(deps.serviceHeaders ?? {})) {
    if (name.toLowerCase().startsWith(SJ_HEADER_PREFIX)) headers.set(name, value);
  }
  const authMode = "authMode" in deps ? deps.authMode : process.env.CASINO_AUTH;
  if (authMode?.trim().toLowerCase() !== "none") {
    const token = await (deps.getToken ?? getCasinoIdToken)(target.origin);
    if (token) headers.set("authorization", `Bearer ${token}`);
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD" && request.body !== null;
  const timeout = AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    redirect: "manual",
    signal: AbortSignal.any([request.signal, timeout]),
  };
  if (hasBody) {
    init.body = request.body;
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await (deps.fetchImpl ?? fetch)(target, init);
  } catch {
    if (timeout.aborted) {
      return new Response("Casino timed out.", { status: 504 });
    }
    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    return new Response("Casino is unavailable.", { status: 502 });
  }

  const responseHeaders = filterResponseHeaders(upstream.headers, target.origin);
  if (isCasinoApiPath(target.pathname) && !responseHeaders.has("cache-control")) {
    responseHeaders.set("cache-control", "no-store");
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
