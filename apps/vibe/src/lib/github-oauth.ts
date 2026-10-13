import { createHmac, randomBytes, timingSafeEqual } from "crypto";

import { getVibeSiteConfig } from "@/lib/site";

const STATE_TTL_MS = 15 * 60 * 1000;

export function stateSecret(
  env: Record<string, string | undefined> = process.env,
): string {
  const secret = env.AUTH_SECRET || env.SJ_VIBE_TOKEN_KEY;
  if (secret) return secret;
  if (env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET or SJ_VIBE_TOKEN_KEY is not set");
  }
  return "dev-vibe";
}

export function githubRedirectUri(): string {
  return `${getVibeSiteConfig().siteUrl}/api/github/callback`;
}

export function githubAuthorizeUrl(state: string): string {
  const id = process.env.GITHUB_CLIENT_ID?.trim();
  if (!id) throw new Error("GITHUB_CLIENT_ID is not set");
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: githubRedirectUri(),
    scope: "read:user repo",
    state,
    allow_signup: "false",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export function createOauthState(email: string, now = Date.now()): string {
  const nonce = randomBytes(12).toString("base64url");
  const payload = `${email}|${now}|${nonce}`;
  const sig = createHmac("sha256", stateSecret())
    .update(payload)
    .digest("base64url");
  return Buffer.from(`${payload}|${sig}`).toString("base64url");
}

export function readOauthState(
  state: string,
  now = Date.now(),
): { email: string } | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const parts = decoded.split("|");
    if (parts.length !== 4) return null;
    const [email, tsRaw, nonce, sig] = parts;
    const payload = `${email}|${tsRaw}|${nonce}`;
    const expected = createHmac("sha256", stateSecret())
      .update(payload)
      .digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const ts = Number(tsRaw);
    if (!Number.isFinite(ts) || now - ts > STATE_TTL_MS) return null;
    return { email };
  } catch {
    return null;
  }
}

export async function exchangeGithubCode(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const id = process.env.GITHUB_CLIENT_ID?.trim();
  const secret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new Error("GitHub OAuth is not configured");
  const res = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: id,
      client_secret: secret,
      code,
      redirect_uri: githubRedirectUri(),
    }),
  });
  if (!res.ok) throw new Error(`GitHub token exchange failed (${res.status})`);
  const body = (await res.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!body.access_token) {
    throw new Error(body.error || "GitHub token exchange returned no token");
  }
  return body.access_token;
}
