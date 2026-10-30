import { beforeEach, describe, expect, it } from "vitest";

import {
  claimTeam,
  getLinksView,
  resetSeasonCache,
  syncWins,
  type LinksDeps,
} from "./casino-links";
import type { HubLeague, HubSeason } from "./hub-snapshots";

const LEAGUE: HubLeague = { leagueId: "football-main", name: "Football", season: 2026, path: "x" };
const SEASON: HubSeason = {
  league: LEAGUE,
  teams: [
    { team: "1", label: "Alpha", owner: "Pat" },
    { team: "2", label: "Beta", owner: "Sam" },
  ],
  results: [
    { team: "1", period: 1, outcome: "W" },
    { team: "1", period: 2, outcome: "U" },
    { team: "2", period: 1, outcome: "L" },
  ],
};

type Call = { method: string; url: string; headers: Headers; body: unknown };

function setup(
  casino: (call: Call) => Response,
  hub: LinksDeps["hub"] = { leagues: async () => [LEAGUE], season: async () => SEASON },
) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: URL, init: RequestInit) => {
    const call: Call = {
      method: String(init.method),
      url: new URL(url).pathname,
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(await new Response(init.body as BodyInit).text()) : undefined,
    };
    calls.push(call);
    return casino(call);
  }) as unknown as typeof fetch;
  const deps: LinksDeps = {
    getMember: async () => ({ id: "1234567890", name: "Pat Jay", email: "pat@example.com" }),
    proxy: { upstream: "https://casino.example", authMode: "none", fetchImpl, env: { CASINO_USER_ID_SALT: "s" } },
    hub,
  };
  return { deps, calls };
}

const view = (links: unknown[] = []) =>
  Response.json({ mod: false, links, taken: [{ league: "football-main", team: "2", mine: false }] });

beforeEach(() => resetSeasonCache());

describe("getLinksView", () => {
  it("adds the hub's leagues and teams to the casino's view", async () => {
    const { deps, calls } = setup(() => view());
    const res = await getLinksView(deps);
    const body = await res.json();
    expect(body.leagues).toEqual([{ league: "football-main", name: "Football", teams: SEASON.teams }]);
    expect(body.taken).toHaveLength(1);
    expect(calls[0].url).toBe("/casino/api/links");
    expect(calls[0].headers.get("x-sj-service")).toBeNull();
  });

  it("omits leagues when the hub can't be read, and passes a casino error through", async () => {
    const down = setup(() => view(), { leagues: async () => null, season: async () => null });
    expect((await (await getLinksView(down.deps)).json()).leagues).toBeUndefined();
    const err = setup(() => new Response("no", { status: 503 }));
    expect((await getLinksView(err.deps)).status).toBe(503);
  });
});

describe("claimTeam", () => {
  it("rejects a team the hub doesn't have, without calling the casino", async () => {
    const { deps, calls } = setup(() => view());
    for (const body of [null, {}, { league: "nope", team: "1" }, { league: "football-main", team: "99" }]) {
      expect((await claimTeam(deps, body)).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("sends hub-checked details to the casino with the service header, then records the baseline", async () => {
    const { deps, calls } = setup((c) => {
      if (c.method === "POST" && c.url.endsWith("/links")) return Response.json({ linked: true });
      if (c.url.endsWith("/links")) return view([{ league: "football-main", team: "1" }]);
      return Response.json({ paid: 0, chips: 0 });
    });
    const res = await claimTeam(deps, { league: "football-main", team: "1", label: "Fake Name", owner: "x@y.z" });
    expect(res.status).toBe(200);
    const post = calls[0];
    expect(post.headers.get("x-sj-service")).toBe("casino-grants");
    // The label and owner come from the hub, not from the browser.
    expect(post.body).toEqual({ league: "football-main", team: "1", label: "Alpha", leagueName: "Football", owner: "Pat" });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /casino/api/links",
      "GET /casino/api/links",
      "POST /casino/api/grants",
    ]);
  });

  it("passes the casino's refusal (team taken) back", async () => {
    const { deps, calls } = setup(() => Response.json({ code: "team-taken" }, { status: 409 }));
    const res = await claimTeam(deps, { league: "football-main", team: "2" });
    expect(res.status).toBe(409);
    expect(calls).toHaveLength(1);
  });
});

describe("syncWins", () => {
  it("reports only the member's own linked teams, with undecided entries, and returns the casino's totals", async () => {
    const { deps, calls } = setup((c) =>
      c.method === "GET"
        ? view([{ league: "football-main", team: "1" }])
        : Response.json({ paid: 1, chips: 5000 }),
    );
    expect(await syncWins(deps)).toEqual({ paid: 1, chips: 5000 });
    const grant = calls.find((c) => c.url.endsWith("/grants"))!;
    expect(grant.headers.get("x-sj-service")).toBe("casino-grants");
    expect(grant.body).toEqual({
      results: [
        { league: "football-main", team: "1", season: 2026, period: 1, outcome: "W" },
        { league: "football-main", team: "1", season: 2026, period: 2, outcome: "U" },
      ],
    });
  });

  it("does nothing for a member with no links (one casino call)", async () => {
    const { deps, calls } = setup(() => view());
    expect(await syncWins(deps)).toEqual({ paid: 0, chips: 0 });
    expect(calls).toHaveLength(1);
  });

  it("is quiet when the casino or the hub fails", async () => {
    const down = setup(() => new Response("x", { status: 503 }));
    expect(await syncWins(down.deps)).toEqual({ paid: 0, chips: 0 });
    const noHub = setup(() => view([{ league: "football-main", team: "1" }]), {
      leagues: async () => [LEAGUE],
      season: async () => null,
    });
    expect(await syncWins(noHub.deps)).toEqual({ paid: 0, chips: 0 });
    expect(noHub.calls).toHaveLength(1);
  });
});
