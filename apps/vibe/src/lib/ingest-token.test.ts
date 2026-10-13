import { describe, expect, it } from "vitest";

import {
  extractIngestToken,
  generateIngestToken,
  hashIngestToken,
  ingestTokenMatches,
  tokensEqual,
} from "./ingest-token";

function request(headers: Record<string, string>): Request {
  return new Request("https://vibe.strictlyjayers.com/api/ingest/health", {
    method: "POST",
    headers,
  });
}

describe("ingest token auth", () => {
  it("hashes stably and compares in constant time", () => {
    const token = generateIngestToken();
    expect(token.startsWith("vs_")).toBe(true);
    const hash = hashIngestToken(token);
    expect(tokensEqual(hash, hashIngestToken(token))).toBe(true);
    expect(tokensEqual(hash, hashIngestToken("vs_nope"))).toBe(false);
  });

  it("accepts Bearer, X-Vibe-Token, and api-key headers", () => {
    const token = "vs_test_token";
    expect(extractIngestToken(request({ authorization: `Bearer ${token}` }))).toBe(
      token,
    );
    expect(extractIngestToken(request({ "x-vibe-token": token }))).toBe(token);
    expect(extractIngestToken(request({ "api-key": token }))).toBe(token);
    expect(extractIngestToken(request({}))).toBeNull();
  });

  it("rejects a missing stored hash or a wrong presented token", () => {
    const token = generateIngestToken();
    const hash = hashIngestToken(token);
    expect(ingestTokenMatches(token, hash)).toBe(true);
    expect(ingestTokenMatches("wrong", hash)).toBe(false);
    expect(ingestTokenMatches(token, null)).toBe(false);
    expect(ingestTokenMatches(null, hash)).toBe(false);
  });
});
