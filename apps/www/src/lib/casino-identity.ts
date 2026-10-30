/**
 * Member identity forwarded to sj-casino as `x-sj-*` request headers.
 *
 * Contract (see PORTAL.md):
 *   x-sj-user-id    opaque, stable id; never an email.
 *   x-sj-user-name  display name, <= 40 chars, URI-encoded UTF-8; never an
 *                   email or its local part.
 *
 * The browser can never set these: casino-proxy strips every incoming
 * `x-sj-*` header first. The Google ID token (Cloud Run IAM) is the trust
 * boundary that lets sj-casino believe them.
 */

import { createHash, createHmac } from "node:crypto";

export const SJ_HEADER_PREFIX = "x-sj-";
export const USER_ID_HEADER = "x-sj-user-id";
export const USER_NAME_HEADER = "x-sj-user-name";
export const USER_ID_LENGTH = 24;
export const USER_NAME_MAX_CHARS = 40;
export const DEFAULT_USER_NAME = "Player";

/** What the casino proxy needs from the Auth.js session. */
export type CasinoMember = {
  /** Auth.js `token.sub` (exposed as `session.user.id` by auth.ts). */
  id?: string | null;
  name?: string | null;
  username?: string | null;
  /** Only used as a last-resort hash input (salt required); never forwarded. */
  email?: string | null;
};

/** Structurally compatible with process.env. */
export type IdentityEnv = Record<string, string | undefined>;

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Opaque stable id. Preference order:
 *  - salt set: HMAC-SHA256(salt, "sj:" + (sub | email)), hex, 24 chars;
 *  - no salt: plain SHA-256 of the sub (never of an email, which is guessable),
 *    hex, 24 chars. Returns null when nothing safe can be derived.
 */
export function casinoUserId(
  member: CasinoMember,
  env: IdentityEnv = process.env,
): string | null {
  const sub = clean(member.id);
  const email = clean(member.email).toLowerCase();
  const salt = clean(env.CASINO_USER_ID_SALT);

  if (salt) {
    const input = sub || email;
    if (!input) return null;
    return createHmac("sha256", salt)
      .update(`sj:${input}`)
      .digest("hex")
      .slice(0, USER_ID_LENGTH);
  }
  if (!sub) return null;
  return createHash("sha256").update(sub).digest("hex").slice(0, USER_ID_LENGTH);
}

function looksLikeEmailPart(candidate: string, email: string): boolean {
  if (candidate.includes("@")) return true;
  if (!email) return false;
  const lower = candidate.toLowerCase();
  const local = email.split("@")[0] ?? "";
  return lower === email || (local !== "" && lower === local);
}

/** Display name: name, then username, then "Player"; <= 40 chars; URI-encoded. */
export function casinoUserName(member: CasinoMember): string {
  const email = clean(member.email).toLowerCase();
  let chosen = DEFAULT_USER_NAME;
  for (const candidate of [clean(member.name), clean(member.username)]) {
    if (candidate && !looksLikeEmailPart(candidate, email)) {
      chosen = candidate;
      break;
    }
  }
  // Truncate by code point so the encoder never sees half a surrogate pair.
  const trimmed = Array.from(chosen).slice(0, USER_NAME_MAX_CHARS).join("").trim();
  return encodeURIComponent(trimmed || DEFAULT_USER_NAME);
}

/** Identity headers for a signed-in member (id omitted if none is derivable). */
export function casinoIdentityHeaders(
  member: CasinoMember,
  env: IdentityEnv = process.env,
): Record<string, string> {
  const headers: Record<string, string> = {
    [USER_NAME_HEADER]: casinoUserName(member),
  };
  const id = casinoUserId(member, env);
  if (id) headers[USER_ID_HEADER] = id;
  return headers;
}
