import { createHash, randomBytes, timingSafeEqual } from "crypto";

const TOKEN_BYTES = 24;

export function generateIngestToken(): string {
  return `vs_${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

export function hashIngestToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

export function tokenPrefix(token: string): string {
  return token.trim().slice(0, 7);
}

export function tokensEqual(aHash: string, bHash: string): boolean {
  const a = Buffer.from(aHash, "hex");
  const b = Buffer.from(bHash, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function extractIngestToken(request: Request): string | null {
  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (/^bearer\s+/i.test(auth)) {
    const token = auth.replace(/^bearer\s+/i, "").trim();
    return token || null;
  }
  const named = (
    request.headers.get("x-vibe-token") ||
    request.headers.get("api-key") ||
    request.headers.get("x-api-key") ||
    ""
  ).trim();
  return named || null;
}

export function ingestTokenMatches(
  presented: string | null,
  storedHash: string | null | undefined,
): boolean {
  if (!presented || !storedHash) return false;
  return tokensEqual(hashIngestToken(presented), storedHash);
}
