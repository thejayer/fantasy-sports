import { describe, expect, it, vi } from "vitest";

import {
  filterRequestHeaders,
  filterResponseHeaders,
  proxyCasino,
  rewriteLocation,
  type CasinoProxyDeps,
} from "./casino-proxy";

const UPSTREAM = "https://casino.example";

function makeDeps(
  overrides: Partial<CasinoProxyDeps> & { fetchImpl?: typeof fetch } = {},
): CasinoProxyDeps {
  return {
    upstream: UPSTREAM,
    isSignedIn: async () => true,
    authMode: undefined,
    getToken: async () => "id-token",
    fetchImpl: (async () => new Response("ok")) as unknown as typeof fetch,
    ...overrides,
  };
}

function portal(path: string, init: RequestInit = {}): Request {
  return new Request(`https://portal.test${path}`, init);
}

describe("filterRequestHeaders", () => {
  it("drops cookie, authorization, host and hop-by-hop headers", () => {
    const out = filterRequestHeaders(
      new Headers({
        cookie: "authjs.session-token=secret",
        authorization: "Bearer browser-token",
        host: "portal.test",
        connection: "keep-alive",
        "keep-alive": "timeout=5",
        "transfer-encoding": "chunked",
        upgrade: "websocket",
        te: "trailers",
        "proxy-authorization": "Basic x",
        "content-length": "12",
        "accept-encoding": "br",
        "x-middleware-subrequest": "1",
        accept: "image/avif",
        "content-type": "application/json",
        "user-agent": "vitest",
      }),
    );
    expect([...out.keys()].sort()).toEqual(["accept", "content-type", "user-agent"]);
  });
});

describe("filterResponseHeaders", () => {
  it("passes through the safe set, every set-cookie, and a relative location", () => {
    const upstream = new Headers({
      "content-type": "image/png",
      "cache-control": "public, max-age=60",
      etag: '"abc"',
      "last-modified": "Wed, 21 Oct 2026 07:28:00 GMT",
      location: `${UPSTREAM}/casino/lobby?x=1`,
      "content-encoding": "gzip",
      "content-length": "99",
      server: "nitro",
      "x-powered-by": "tanstack",
    });
    upstream.append("set-cookie", "a=1; Path=/casino");
    upstream.append("set-cookie", "b=2; Path=/casino; HttpOnly");

    const out = filterResponseHeaders(upstream, UPSTREAM);

    expect(out.get("content-type")).toBe("image/png");
    expect(out.get("cache-control")).toBe("public, max-age=60");
    expect(out.get("etag")).toBe('"abc"');
    expect(out.get("last-modified")).toBe("Wed, 21 Oct 2026 07:28:00 GMT");
    expect(out.get("location")).toBe("/casino/lobby?x=1");
    expect(out.getSetCookie()).toEqual([
      "a=1; Path=/casino",
      "b=2; Path=/casino; HttpOnly",
    ]);
    expect(out.has("content-encoding")).toBe(false);
    expect(out.has("content-length")).toBe(false);
    expect(out.has("server")).toBe(false);
    expect(out.has("x-powered-by")).toBe(false);
  });
});

describe("rewriteLocation", () => {
  it("makes same-origin locations relative and leaves others alone", () => {
    expect(rewriteLocation(`${UPSTREAM}/casino/a#b`, UPSTREAM)).toBe("/casino/a#b");
    expect(rewriteLocation("/casino/a", UPSTREAM)).toBe("/casino/a");
    expect(rewriteLocation("https://elsewhere.example/x", UPSTREAM)).toBe(
      "https://elsewhere.example/x",
    );
  });
});

describe("proxyCasino", () => {
  it("is a 404 when CASINO_URL is unset, even for signed-out visitors", async () => {
    const isSignedIn = vi.fn(async () => false);
    for (const upstream of [null, undefined]) {
      const saved = process.env.CASINO_URL;
      delete process.env.CASINO_URL;
      const res = await proxyCasino(
        portal("/casino"),
        makeDeps({ upstream: upstream as null, isSignedIn }),
      );
      if (saved !== undefined) process.env.CASINO_URL = saved;
      expect(res.status).toBe(404);
    }
    expect(isSignedIn).not.toHaveBeenCalled();
  });

  it("redirects signed-out page requests to /login and never calls upstream", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const res = await proxyCasino(
      portal("/casino?room=2", { headers: { accept: "text/html" } }),
      makeDeps({ isSignedIn: async () => false, fetchImpl }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `/login?callbackUrl=${encodeURIComponent("/casino?room=2")}`,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns 401 for signed-out images and API calls", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const deps = makeDeps({ isSignedIn: async () => false, fetchImpl });
    expect((await proxyCasino(portal("/casino/cards/x.jpg"), deps)).status).toBe(401);
    expect(
      (await proxyCasino(portal("/casino/api/spin", { method: "POST", body: "{}" }), deps)).status,
    ).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("proxies path and query with a Bearer ID token and without browser credentials", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>lobby</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));
    const getToken = vi.fn(async () => "id-token");
    const res = await proxyCasino(
      portal("/casino/lobby/?a=1&b=two", {
        headers: { cookie: "session=secret", authorization: "Bearer browser", accept: "text/html" },
      }),
      makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch, getToken }),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>lobby</html>");
    expect(getToken).toHaveBeenCalledWith(UPSTREAM);

    const [target, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(target)).toBe(`${UPSTREAM}/casino/lobby/?a=1&b=two`);
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const sent = new Headers(init.headers);
    expect(sent.get("authorization")).toBe("Bearer id-token");
    expect(sent.has("cookie")).toBe(false);
    expect(sent.get("accept")).toBe("text/html");
  });

  it("proxies the bare /casino path", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    await proxyCasino(portal("/casino"), makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(String((fetchImpl.mock.calls[0] as unknown as [URL])[0])).toBe(`${UPSTREAM}/casino`);
  });

  it("streams request bodies with duplex half", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const res = await proxyCasino(
      portal("/casino/api/spin", { method: "POST", body: "bet=5", headers: { "content-type": "text/plain" } }),
      makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
    expect(res.status).toBe(204);
    const init = (fetchImpl.mock.calls[0] as unknown as [URL, RequestInit & { duplex?: string }])[1];
    expect(init.method).toBe("POST");
    expect(init.duplex).toBe("half");
    expect(init.body).toBeInstanceOf(ReadableStream);
  });

  it("sends no body for GET and HEAD", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    await proxyCasino(portal("/casino/x"), makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    const init = (fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect(init.body).toBeUndefined();
  });

  it("passes upstream redirects through without following them", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: `${UPSTREAM}/casino/lobby` } }),
    );
    const res = await proxyCasino(portal("/casino/old"), makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/casino/lobby");
  });

  it("sends no token when the metadata server is unreachable", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    await proxyCasino(
      portal("/casino"),
      makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch, getToken: async () => null }),
    );
    const init = (fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect(new Headers(init.headers).has("authorization")).toBe(false);
  });

  it("skips the token entirely when CASINO_AUTH=none", async () => {
    const getToken = vi.fn(async () => "id-token");
    const fetchImpl = vi.fn(async () => new Response("ok"));
    await proxyCasino(
      portal("/casino"),
      makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch, getToken, authMode: "none" }),
    );
    expect(getToken).not.toHaveBeenCalled();
    const init = (fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect(new Headers(init.headers).has("authorization")).toBe(false);
  });

  it("maps upstream failures to 502 and timeouts to 504", async () => {
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(
      (await proxyCasino(portal("/casino"), makeDeps({ fetchImpl: down as unknown as typeof fetch }))).status,
    ).toBe(502);

    const hang = vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    expect(
      (
        await proxyCasino(
          portal("/casino"),
          makeDeps({ fetchImpl: hang as unknown as typeof fetch, timeoutMs: 20 }),
        )
      ).status,
    ).toBe(504);
  });
});
