import { describe, expect, it, vi } from "vitest";

import {
  SUMMARY_PATH,
  SUMMARY_RETRY_MS,
  SUMMARY_STALE_MS,
  SUMMARY_TTL_MS,
  createSummaryCache,
  parseSummary,
  type SummaryDeps,
} from "./casino-summary";

const UPSTREAM = "https://casino.example";
const EMAIL = "pat.jay@example.com";
const MEMBER = { id: "1234567890", name: "Pat Jay", email: EMAIL };

const RAW = {
  date: "2026-10-30",
  asOf: "2026-10-30T18:00:00.000Z",
  top: [
    { rank: 1, name: "Ada Lovelace", value: 48000 },
    { rank: 2, name: "Grace Hopper", value: 12500 },
  ],
  hot: [
    { machine: "lucky-7s", name: "Lucky 7s", tag: "loose", tagLabel: "Loose", spins: 120, wins: 41, jackpots: 2 },
  ],
  players: 5,
};

function ok(body: unknown = RAW): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function setup(responses: Array<() => Response | Promise<Response>>) {
  let clock = 1_000_000;
  const calls: Array<{ url: string; headers: Headers }> = [];
  let i = 0;
  const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    const next = responses[Math.min(i++, responses.length - 1)];
    return next();
  }) as unknown as typeof fetch;
  const deps: SummaryDeps = {
    getMember: async () => MEMBER,
    now: () => clock,
    proxy: {
      upstream: UPSTREAM,
      authMode: undefined,
      getToken: async () => "id-token",
      fetchImpl,
      env: { CASINO_USER_ID_SALT: "test-salt" },
    },
  };
  return { cache: createSummaryCache(), deps, calls, advance: (ms: number) => (clock += ms) };
}

describe("parseSummary", () => {
  it("keeps only the fields the home page shows", () => {
    const out = parseSummary({ ...RAW, memberId: "secret-id", top: [{ ...RAW.top[0], id: "abc" }] });
    expect(out).toEqual({
      date: "2026-10-30",
      top: [{ rank: 1, name: "Ada Lovelace", value: 48000 }],
      hot: [RAW.hot[0]],
      players: 5,
    });
    expect(JSON.stringify(out)).not.toMatch(/secret-id|abc|asOf/);
  });

  it("accepts an empty day", () => {
    expect(parseSummary({ date: "2026-10-30", top: [], hot: [], players: 0 })).toEqual({
      date: "2026-10-30",
      top: [],
      hot: [],
      players: 0,
    });
  });

  it("never lets an email or control characters through as a name", () => {
    const out = parseSummary({
      ...RAW,
      top: [
        { rank: 1, name: EMAIL, value: 10 },
        { rank: 2, name: "Bo\u0000b\nby", value: 9 },
        { rank: 3, name: "x".repeat(100), value: 8 },
      ],
    });
    expect(out?.top[0].name).toBe("Player");
    expect(out?.top[1].name).toBe("Bobby");
    expect(out?.top[2].name).toHaveLength(40);
  });

  it("caps the lists at three rows", () => {
    const top = [1, 2, 3, 4, 5].map((rank) => ({ rank, name: `P${rank}`, value: 100 - rank }));
    expect(parseSummary({ ...RAW, top })?.top).toHaveLength(3);
  });

  it("rejects the wrong shape", () => {
    expect(parseSummary(null)).toBeNull();
    expect(parseSummary("nope")).toBeNull();
    expect(parseSummary({ top: [], players: 0 })).toBeNull();
    expect(parseSummary({ ...RAW, top: [{ rank: 1, name: "A", value: -5 }] })).toBeNull();
    expect(parseSummary({ ...RAW, top: [{ rank: 1, name: "A", value: "9" }] })).toBeNull();
    expect(parseSummary({ ...RAW, hot: [{ ...RAW.hot[0], tag: "wild" }] })).toBeNull();
    expect(parseSummary({ ...RAW, hot: [{ ...RAW.hot[0], spins: NaN }] })).toBeNull();
  });
});

describe("createSummaryCache", () => {
  it("fetches through the authenticated proxy path with identity headers", async () => {
    const { cache, deps, calls } = setup([() => ok()]);
    const out = await cache.get(deps);
    expect(out?.top[0].name).toBe("Ada Lovelace");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${UPSTREAM}${SUMMARY_PATH}`);
    expect(calls[0].headers.get("authorization")).toBe("Bearer id-token");
    expect(calls[0].headers.get("x-sj-user-id")).toMatch(/^[0-9a-f]+$/);
    expect(JSON.stringify([...calls[0].headers])).not.toContain(EMAIL);
  });

  it("serves the cache inside the TTL, then refreshes", async () => {
    const { cache, deps, calls, advance } = setup([() => ok(), () => ok({ ...RAW, players: 9 })]);
    await cache.get(deps);
    advance(SUMMARY_TTL_MS - 1);
    expect((await cache.get(deps))?.players).toBe(5);
    expect(calls).toHaveLength(1);
    advance(2);
    expect((await cache.get(deps))?.players).toBe(9);
    expect(calls).toHaveLength(2);
  });

  it("shares one upstream request between concurrent callers", async () => {
    const { cache, deps, calls } = setup([() => ok()]);
    const [a, b, c] = await Promise.all([cache.get(deps), cache.get(deps), cache.get(deps)]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(calls).toHaveLength(1);
  });

  it("returns null when the casino is down and nothing is cached", async () => {
    const { cache, deps } = setup([() => new Response("nope", { status: 502 })]);
    expect(await cache.get(deps)).toBeNull();
  });

  it("returns null for an unparseable or unexpected body", async () => {
    const bad = setup([() => ok({ hello: "world" })]);
    expect(await bad.cache.get(bad.deps)).toBeNull();
    const text = setup([() => new Response("<html>", { status: 200 })]);
    expect(await text.cache.get(text.deps)).toBeNull();
  });

  it("serves the last good copy while the casino is failing, then gives up", async () => {
    const { cache, deps, calls, advance } = setup([
      () => ok(),
      () => new Response("down", { status: 503 }),
    ]);
    await cache.get(deps);
    advance(SUMMARY_TTL_MS + 1);
    expect((await cache.get(deps))?.players).toBe(5);
    expect(calls).toHaveLength(2);
    advance(SUMMARY_STALE_MS);
    expect(await cache.get(deps)).toBeNull();
  });

  it("backs off after a failure instead of hammering the casino", async () => {
    const { cache, deps, calls, advance } = setup([() => new Response("down", { status: 503 })]);
    await cache.get(deps);
    await cache.get(deps);
    await cache.get(deps);
    expect(calls).toHaveLength(1);
    advance(SUMMARY_RETRY_MS + 1);
    await cache.get(deps);
    expect(calls).toHaveLength(2);
  });

  it("treats a network error or a signed-out member as unavailable", async () => {
    const boom = setup([
      () => {
        throw new Error("ECONNREFUSED");
      },
    ]);
    expect(await boom.cache.get(boom.deps)).toBeNull();
    const out = setup([() => ok()]);
    out.deps.getMember = async () => null;
    expect(await out.cache.get(out.deps)).toBeNull();
    expect(out.calls).toHaveLength(0);
  });

  it("is off when no casino is configured", async () => {
    const { cache, deps, calls } = setup([() => ok()]);
    deps.proxy = { ...deps.proxy, upstream: null };
    expect(await cache.get(deps)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
