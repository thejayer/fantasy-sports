import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FAILURE_BACKOFF_MS,
  METADATA_IDENTITY_URL,
  REFRESH_MARGIN_MS,
  clearCasinoTokenCache,
  getCasinoIdToken,
  jwtExpiryMs,
} from "./casino-token";

const AUDIENCE = "https://casino.example";

function jwt(expSeconds: number, tag = "a"): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256" })}.${encode({ exp: expSeconds, tag })}.sig`;
}

function tokenResponse(token: string): Response {
  return new Response(token, { status: 200 });
}

beforeEach(() => {
  clearCasinoTokenCache();
});

describe("jwtExpiryMs", () => {
  it("reads exp in ms and tolerates junk", () => {
    expect(jwtExpiryMs(jwt(1_700_000_000))).toBe(1_700_000_000_000);
    expect(jwtExpiryMs("not-a-jwt")).toBeNull();
    expect(jwtExpiryMs("a.b.c")).toBeNull();
    expect(jwtExpiryMs(`a.${Buffer.from("{}").toString("base64url")}.c`)).toBeNull();
  });
});

describe("getCasinoIdToken", () => {
  it("asks the metadata server for the audience with Metadata-Flavor", async () => {
    const now = 1_000_000;
    const fetchImpl = vi.fn(async () =>
      tokenResponse(jwt(now / 1000 + 3600)),
    ) as unknown as typeof fetch;

    const token = await getCasinoIdToken(AUDIENCE, { fetchImpl, now: () => now });

    expect(token).toBe(jwt(now / 1000 + 3600));
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${METADATA_IDENTITY_URL}?audience=${encodeURIComponent(AUDIENCE)}`,
    );
    expect(new Headers(init.headers).get("metadata-flavor")).toBe("Google");
  });

  it("serves the cache until about 5 minutes before exp, then refreshes", async () => {
    let now = 0;
    const exp = 3600; // seconds
    const first = jwt(exp, "first");
    const second = jwt(exp + 3600, "second");
    const responses = [first, second];
    const fetchImpl = vi.fn(async () =>
      tokenResponse(responses.shift() as string),
    ) as unknown as typeof fetch;
    const deps = { fetchImpl, now: () => now };

    expect(await getCasinoIdToken(AUDIENCE, deps)).toBe(first);

    now = exp * 1000 - REFRESH_MARGIN_MS - 1;
    expect(await getCasinoIdToken(AUDIENCE, deps)).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now = exp * 1000 - REFRESH_MARGIN_MS;
    expect(await getCasinoIdToken(AUDIENCE, deps)).toBe(second);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caches per audience", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      tokenResponse(jwt(9_999_999_999, String(url))),
    ) as unknown as typeof fetch;
    const deps = { fetchImpl, now: () => 0 };
    const a = await getCasinoIdToken("https://a.example", deps);
    const b = await getCasinoIdToken("https://b.example", deps);
    expect(a).not.toBe(b);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("shares one metadata request between concurrent callers", async () => {
    const fetchImpl = vi.fn(async () =>
      tokenResponse(jwt(9_999_999_999)),
    ) as unknown as typeof fetch;
    const deps = { fetchImpl, now: () => 0 };
    const [a, b] = await Promise.all([
      getCasinoIdToken(AUDIENCE, deps),
      getCasinoIdToken(AUDIENCE, deps),
    ]);
    expect(a).toBe(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns null when the metadata server is unreachable, then backs off", async () => {
    let now = 0;
    const fetchImpl = vi.fn(async () => {
      throw new Error("ENOTFOUND metadata.google.internal");
    }) as unknown as typeof fetch;
    const deps = { fetchImpl, now: () => now };

    expect(await getCasinoIdToken(AUDIENCE, deps)).toBeNull();
    expect(await getCasinoIdToken(AUDIENCE, deps)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now = FAILURE_BACKOFF_MS;
    expect(await getCasinoIdToken(AUDIENCE, deps)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats a non-200 or empty metadata reply as no token", async () => {
    const bad = vi.fn(async () => new Response("nope", { status: 403 }));
    expect(
      await getCasinoIdToken(AUDIENCE, {
        fetchImpl: bad as unknown as typeof fetch,
        now: () => 0,
      }),
    ).toBeNull();

    clearCasinoTokenCache();
    const empty = vi.fn(async () => new Response("  ", { status: 200 }));
    expect(
      await getCasinoIdToken(AUDIENCE, {
        fetchImpl: empty as unknown as typeof fetch,
        now: () => 0,
      }),
    ).toBeNull();
  });
});
