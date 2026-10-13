import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function parseTokenKey(raw: string | undefined): Buffer | null {
  const value = raw?.trim() ?? "";
  if (!value) return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }
  try {
    const buf = Buffer.from(value, "base64");
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

export function getTokenKey(): Buffer {
  const key = parseTokenKey(process.env.SJ_VIBE_TOKEN_KEY);
  if (!key) {
    throw new Error("SJ_VIBE_TOKEN_KEY must be 32 bytes (64 hex chars)");
  }
  return key;
}

/** `iv.ciphertext.tag` as base64url, all parts base64url. */
export function encryptSecret(plain: string, key = getTokenKey()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, encrypted, tag].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(payload: string, key = getTokenKey()): string {
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new Error("invalid encrypted secret");
  }
  const [ivB64, dataB64, tagB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const data = Buffer.from(dataB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("invalid encrypted secret");
  }
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
