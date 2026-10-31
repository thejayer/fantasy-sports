import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Sign out of every Strictly Jayers site (www, hub, fitness, vibe).
 *
 * Each site keeps its own host-only session cookie, so one site cannot clear
 * another's. The browser is walked through a hop route on each site instead:
 *
 *   any site  POST /api/signout-all (www) or /api/auth/signout-all (the others)
 *             same-origin only; signs THIS site out, 303 to the first hop
 *   next site GET  /api/auth/signout-chain?t=…  signs that site out, 303 onward
 *   …
 *   www       GET  /signed-out                  the landing page
 *
 * Order: the site you clicked on is cleared first (so a failed hop can never
 * leave you signed in where you pressed the button), then www (the account
 * home: team links, mod tools, bets), then the rest in a fixed order.
 *
 * What keeps this from being an open redirect or a CSRF sign-out:
 *  - No URL ever travels in a query string. The token names the sites still to
 *    visit by key (www, hub, fitness, vibe); every site maps a key to a URL from
 *    its OWN server config, so the only hosts a hop can send a browser to are
 *    the Strictly Jayers hosts already configured for that site.
 *  - The token is an HMAC over the remaining keys and an expiry, keyed from the
 *    Auth.js secret (all four sites mount the same one in production) with a
 *    purpose label, so it can never be mistaken for, or turned into, a session.
 *    A hop with a missing, bad or expired token signs nobody out.
 *  - The chain is only started by a same-origin POST, behind a confirm.
 *
 * This file is identical in apps/www, apps/web, apps/fitness and apps/vibe;
 * packages/sj-ui/check.sh fails if the copies drift, so keep them in step.
 */

export type SiteKey = "www" | "hub" | "fitness" | "vibe";
export const SITE_KEYS: readonly SiteKey[] = ["www", "hub", "fitness", "vibe"];
export type SiteUrls = Partial<Record<SiteKey, string>>;

export const HOP_PATH = "/api/auth/signout-chain";
export const SIGNED_OUT_PATH = "/signed-out";
/** Long enough for four redirects on a slow phone, short enough that a leaked link is useless. */
export const CHAIN_TTL_MS = 2 * 60 * 1000;

const CONTEXT = "sj-signout-chain/v1";
const MAX_TOKEN_CHARS = 512;

type Payload = { v: 1; exp: number; n: string; rest: SiteKey[] };

function isSiteKey(value: unknown): value is SiteKey {
  return typeof value === "string" && (SITE_KEYS as readonly string[]).includes(value);
}

function macKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(CONTEXT).digest();
}

function mac(secret: string, body: string): Buffer {
  return createHmac("sha256", macKey(secret)).update(body).digest();
}

/** The remaining sites to visit, signed and time-limited. */
export function signChain(secret: string, rest: readonly SiteKey[], now: number = Date.now()): string {
  const payload: Payload = {
    v: 1,
    exp: now + CHAIN_TTL_MS,
    n: randomBytes(6).toString("base64url"),
    rest: rest.filter(isSiteKey),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(secret, body).toString("base64url")}`;
}

/** The sites still to visit, or null for anything that is not a fresh token signed with this secret. */
export function verifyChain(
  secret: string,
  token: string | null | undefined,
  now: number = Date.now(),
): { rest: SiteKey[] } | null {
  if (!secret || !token || token.length > MAX_TOKEN_CHARS) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const expected = mac(secret, body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<Payload>;
  } catch {
    return null;
  }
  if (payload.v !== 1 || typeof payload.exp !== "number" || payload.exp < now) return null;
  if (!Array.isArray(payload.rest)) return null;
  return { rest: payload.rest.filter(isSiteKey) };
}

function httpBase(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The next configured site in `rest` (sites with no URL here are skipped) and what remains after it. */
export function nextHop(
  urls: SiteUrls,
  rest: readonly SiteKey[],
): { origin: string; after: SiteKey[] } | null {
  for (let i = 0; i < rest.length; i += 1) {
    const origin = httpBase(urls[rest[i] as SiteKey]);
    if (origin) return { origin, after: rest.slice(i + 1) };
  }
  return null;
}

export function hopUrl(origin: string, token: string): string {
  return `${origin}${HOP_PATH}?t=${encodeURIComponent(token)}`;
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

/** Where to send the browser once `after` is what is left to visit: the next hop, else the www landing page. */
export function chainStep(
  urls: SiteUrls,
  secret: string,
  after: readonly SiteKey[],
  now: number = Date.now(),
): Response {
  const next = nextHop(urls, after);
  if (next) return redirect(hopUrl(next.origin, signChain(secret, next.after, now)));
  const www = httpBase(urls.www);
  if (www) return redirect(`${www}${SIGNED_OUT_PATH}`);
  return new Response("Signed out.", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export type HopDeps = {
  secret: string | undefined;
  urls: SiteUrls;
  /** Clears this site's own session. Only called for a valid token. */
  signOutLocal: () => Promise<unknown>;
  now?: number;
};

/** One hop: verify, sign this site out, pass the browser on. Invalid or expired links do nothing. */
export async function runHop(token: string | null, deps: HopDeps): Promise<Response> {
  const now = deps.now ?? Date.now();
  const verified = deps.secret ? verifyChain(deps.secret, token, now) : null;
  if (!verified || !deps.secret) {
    return new Response(
      "<!doctype html><meta charset=utf-8><meta name=robots content=noindex><title>Sign out link expired</title>" +
        "<p>This sign-out link is invalid or has expired. Open your profile and choose Sign out again.</p>",
      {
        status: 400,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      },
    );
  }
  await deps.signOutLocal();
  return chainStep(deps.urls, deps.secret, verified.rest, now);
}

/**
 * Who to visit after `start` signed itself out: www first (the account home),
 * then the other sites in a fixed order. Never includes `start`.
 */
export function sitesAfter(start: SiteKey): SiteKey[] {
  return SITE_KEYS.filter((key) => key !== start);
}

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

export type StartDeps = {
  /** Which site this is. */
  self: SiteKey;
  secret: string | undefined;
  urls: SiteUrls;
  /** Clears this site's own session. */
  signOutLocal: () => Promise<unknown>;
  /** Same-origin path to land on when there is nowhere to chain to (no shared secret, or no other site configured). */
  localLanding: string;
  now?: number;
};

/**
 * Start "sign out of every site" from this site. Call it from a POST route.
 *
 * 1. A request that is not same-origin is refused (403) and signs nobody out.
 * 2. This site is signed out, unconditionally. From here on, a failing hop can
 *    only leave the OTHER sites as they are today, never this one.
 * 3. The browser is handed to the next hop with a fresh signed token, or, when
 *    no hop is possible (no shared secret configured), to `localLanding`,
 *    which is exactly what a plain local sign out did before.
 */
export async function startChain(request: Request, deps: StartDeps): Promise<Response> {
  if (!isSameOriginRequest(request, deps.urls[deps.self] ?? "")) {
    return new Response("Forbidden", { status: 403, headers: { "cache-control": "no-store" } });
  }
  await deps.signOutLocal();
  const secret = deps.secret ?? "";
  const rest = sitesAfter(deps.self);
  const canChain = secret && (nextHop(deps.urls, rest) || httpBase(deps.urls.www));
  if (!canChain) return redirect(deps.localLanding);
  return chainStep(deps.urls, secret, rest, deps.now ?? Date.now());
}
