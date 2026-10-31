import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Sign out of every Strictly Jayers site (www, hub, fitness, vibe).
 *
 * Each site keeps its own host-only session cookie, so one site cannot clear
 * another's. The browser is walked through a hop route on each site instead:
 *
 *   www  POST /api/signout-all             signs www out, 303 to the first hop
 *   hub  GET  /api/auth/signout-chain?t=…  signs that site out, 303 to the next hop
 *   …
 *   www  GET  /signed-out                  the landing page
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
 *  - The chain is only started by a same-origin POST on www, behind a confirm.
 *
 * This file is identical in apps/www, apps/web, apps/fitness and apps/vibe;
 * keep the four copies in step.
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
