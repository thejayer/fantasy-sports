import { describe, expect, it, vi } from "vitest";

import {
  filterRequestHeaders,
  filterResponseHeaders,
  proxyCasino,
  rewriteLocation,
  type CasinoProxyDeps,
} from "./casino-proxy";

const UPSTREAM = "https://casino.example";
const EMAIL = "pat.jay@example.com";
const MEMBER = { id: "1234567890", name: "Pat Jay", email: EMAIL };

function makeDeps(
  overrides: Partial<CasinoProxyDeps> & { fetchImpl?: typeof fetch } = {},
): CasinoProxyDeps {
  return {
    upstream: UPSTREAM,
    getMember: async () => MEMBER,
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
    const getMember = vi.fn(async () => null);
    for (const upstream of [null, undefined]) {
      const saved = process.env.CASINO_URL;
      delete process.env.CASINO_URL;
      const res = await proxyCasino(
        portal("/casino"),
        makeDeps({ upstream: upstream as null, getMember }),
      );
      if (saved !== undefined) process.env.CASINO_URL = saved;
      expect(res.status).toBe(404);
    }
    expect(getMember).not.toHaveBeenCalled();
  });

  it("redirects signed-out page requests to /login and never calls upstream", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const res = await proxyCasino(
      portal("/casino?room=2", { headers: { accept: "text/html" } }),
      makeDeps({ getMember: async () => null, fetchImpl }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `/login?callbackUrl=${encodeURIComponent("/casino?room=2")}`,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns 401 for signed-out images and API calls", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const deps = makeDeps({ getMember: async () => null, fetchImpl });
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

  describe("member identity", () => {
    function sentHeaders(fetchImpl: ReturnType<typeof vi.fn>): Headers {
      return new Headers((fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1].headers);
    }

    it("adds x-sj-user-id and x-sj-user-name for a signed-in member", async () => {
      const fetchImpl = vi.fn(async () => new Response("ok"));
      await proxyCasino(
        portal("/casino/api/chat"),
        makeDeps({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          env: { CASINO_USER_ID_SALT: "salt" },
        }),
      );
      const sent = sentHeaders(fetchImpl);
      expect(sent.get("x-sj-user-id")).toMatch(/^[0-9a-f]{24}$/);
      expect(sent.get("x-sj-user-id")).not.toContain("1234567890");
      expect(sent.get("x-sj-user-name")).toBe("Pat%20Jay");
    });

    it("strips spoofed x-sj-* headers (any case) even when signed in", async () => {
      const fetchImpl = vi.fn(async () => new Response("ok"));
      await proxyCasino(
        portal("/casino/api/chat", {
          headers: {
            "X-SJ-User-Id": "attacker",
            "x-sj-user-name": "Admin",
            "X-Sj-Role": "admin",
            "x-sj-anything": "1",
          },
        }),
        makeDeps({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getMember: async () => ({ id: "42", name: "Real Name" }),
          env: {},
        }),
      );
      const sent = sentHeaders(fetchImpl);
      expect([...sent.keys()].filter((k) => k.startsWith("x-sj-")).sort()).toEqual([
        "x-sj-user-id",
        "x-sj-user-name",
      ]);
      expect(sent.get("x-sj-user-id")).not.toBe("attacker");
      expect(sent.get("x-sj-user-name")).toBe("Real%20Name");
      expect(sent.has("x-sj-role")).toBe(false);
    });

    it("adds x-sj-user-alias (the email-based id) for a member with a subject and an email", async () => {
      const fetchImpl = vi.fn(async () => new Response("ok"));
      await proxyCasino(
        portal("/casino/api/chat"),
        makeDeps({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getMember: async () => ({ googleSub: "1234567890", id: "uuid", name: "Pat Jay", email: EMAIL }),
          env: { CASINO_USER_ID_SALT: "salt" },
        }),
      );
      const sent = sentHeaders(fetchImpl);
      expect(sent.get("x-sj-user-id")).toMatch(/^[0-9a-f]{24}$/);
      expect(sent.get("x-sj-user-alias")).toMatch(/^[0-9a-f]{24}$/);
      expect(sent.get("x-sj-user-alias")).not.toBe(sent.get("x-sj-user-id"));
      expect(sent.get("x-sj-user-alias")).not.toContain("pat");
    });

    it("sends no alias without a Google subject (old session)", async () => {
      const fetchImpl = vi.fn(async () => new Response("ok"));
      await proxyCasino(
        portal("/casino/api/chat"),
        makeDeps({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getMember: async () => ({ id: "uuid", name: "Pat Jay", email: EMAIL }),
          env: { CASINO_USER_ID_SALT: "salt" },
        }),
      );
      const sent = sentHeaders(fetchImpl);
      expect(sent.has("x-sj-user-id")).toBe(true);
      expect(sent.has("x-sj-user-alias")).toBe(false);
    });

    it("strips a client-sent x-sj-user-alias (any case), signed in or not", async () => {
      for (const member of [
        { id: "uuid", name: "Pat", email: EMAIL }, // no alias of its own
        { googleSub: "1234567890", id: "uuid", name: "Pat", email: EMAIL }, // own alias replaces it
      ]) {
        const fetchImpl = vi.fn(async () => new Response("ok"));
        await proxyCasino(
          portal("/casino/api/chat", {
            headers: { "X-SJ-User-Alias": "attacker", "x-sj-user-id": "attacker" },
          }),
          makeDeps({
            fetchImpl: fetchImpl as unknown as typeof fetch,
            getMember: async () => member,
            env: { CASINO_USER_ID_SALT: "salt" },
          }),
        );
        const sent = sentHeaders(fetchImpl);
        expect(sent.get("x-sj-user-alias")).not.toBe("attacker");
        expect(sent.get("x-sj-user-id")).not.toBe("attacker");
      }
      // A member with no derivable id gets no alias at all, whatever the client sent.
      const fetchImpl = vi.fn(async () => new Response("ok"));
      await proxyCasino(
        portal("/casino/api/chat", { headers: { "x-sj-user-alias": "attacker" } }),
        makeDeps({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getMember: async () => ({ email: EMAIL }),
          env: {},
        }),
      );
      expect(sentHeaders(fetchImpl).has("x-sj-user-alias")).toBe(false);
    });

    it("sends no spoofed identity when the member has no derivable id", async () => {
      const fetchImpl = vi.fn(async () => new Response("ok"));
      await proxyCasino(
        portal("/casino/api/chat", { headers: { "x-sj-user-id": "attacker" } }),
        makeDeps({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getMember: async () => ({ email: EMAIL }),
          env: {},
        }),
      );
      const sent = sentHeaders(fetchImpl);
      expect(sent.has("x-sj-user-id")).toBe(false);
      expect(sent.get("x-sj-user-name")).toBe("Player");
    });

    it("never puts the email (or its local part) in any forwarded header", async () => {
      const fetchImpl = vi.fn(async () => new Response("ok"));
      await proxyCasino(
        portal("/casino/api/chat?since=0", {
          headers: { accept: "application/json", "user-agent": "vitest" },
        }),
        makeDeps({
          fetchImpl: fetchImpl as unknown as typeof fetch,
          getMember: async () => ({ id: "42", name: EMAIL, username: "pat.jay", email: EMAIL }),
          env: { CASINO_USER_ID_SALT: "salt" },
        }),
      );
      const all = [...sentHeaders(fetchImpl).entries()]
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
        .toLowerCase();
      expect(all).not.toContain(EMAIL);
      expect(all).not.toContain("pat.jay");
      expect(all).not.toContain("%40");
      expect(all).toContain("x-sj-user-name: player");
    });

    it("does not call the casino when signed out (no identity to forward)", async () => {
      const fetchImpl = vi.fn(async () => new Response("ok"));
      const res = await proxyCasino(
        portal("/casino/api/chat", { method: "POST", headers: { "x-sj-user-id": "attacker" } }),
        makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch, getMember: async () => null }),
      );
      expect(res.status).toBe(401);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe("chat polling and /casino/api caching", () => {
    it("forwards GET /casino/api/chat?since=… and passes 429 JSON, retry-after and no-store", async () => {
      const fetchImpl = vi.fn(async () =>
        new Response(JSON.stringify({ error: "slow down" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "3" },
        }),
      );
      const res = await proxyCasino(
        portal("/casino/api/chat?since=1730000000000", { headers: { accept: "application/json" } }),
        makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      );
      expect((fetchImpl.mock.calls[0] as unknown as [URL])[0].toString()).toBe(
        `${UPSTREAM}/casino/api/chat?since=1730000000000`,
      );
      expect(res.status).toBe(429);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(res.headers.get("retry-after")).toBe("3");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: "slow down" });
    });

    it("forwards POST JSON bodies to the chat endpoint", async () => {
      const fetchImpl = vi.fn(async (_url: URL, init: RequestInit) => {
        const body = await new Response(init.body as ReadableStream).text();
        return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
      });
      const res = await proxyCasino(
        portal("/casino/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "hello" }),
        }),
        makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ text: "hello" });
      expect(res.headers.get("cache-control")).toBe("no-store");
      const init = (fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1];
      expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    });

    it("keeps an upstream cache-control on /casino/api/*", async () => {
      const fetchImpl = vi.fn(async () =>
        new Response("{}", { headers: { "cache-control": "private, max-age=5" } }),
      );
      const res = await proxyCasino(
        portal("/casino/api/state"),
        makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      );
      expect(res.headers.get("cache-control")).toBe("private, max-age=5");
    });

    it("does not add no-store to non-API assets or pages", async () => {
      const fetchImpl = vi.fn(async () => new Response("img"));
      for (const path of ["/casino/cards/x.jpg", "/casino/apiary", "/casino"]) {
        const res = await proxyCasino(
          portal(path),
          makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
        );
        expect(res.headers.has("cache-control")).toBe(false);
      }
    });
  });
});

describe("proxyCasino serviceHeaders", () => {
  it("sets the portal's own x-sj-service header, and a browser's is always stripped", async () => {
    const seen: Headers[] = [];
    const fetchImpl = (async (_u: URL, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      return new Response("ok");
    }) as unknown as typeof fetch;
    const browser = portal("/casino/api/grants", {
      method: "POST",
      headers: { "x-sj-service": "casino-grants", "x-sj-user-id": "forged" },
      body: "{}",
    });
    await proxyCasino(browser, makeDeps({ fetchImpl }));
    expect(seen[0].get("x-sj-service")).toBeNull();
    expect(seen[0].get("x-sj-user-id")).not.toBe("forged");

    await proxyCasino(
      portal("/casino/api/grants", { method: "POST", body: "{}" }),
      makeDeps({ fetchImpl, serviceHeaders: { "x-sj-service": "casino-grants", "x-other": "no" } }),
    );
    expect(seen[1].get("x-sj-service")).toBe("casino-grants");
    // Only x-sj-* names are honoured.
    expect(seen[1].get("x-other")).toBeNull();
  });
});
