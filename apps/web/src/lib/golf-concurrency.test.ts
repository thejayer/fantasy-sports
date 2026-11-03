import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildGolfSnapshot } from "./golf";
import { createAuctionRoom, nominatePlayer, startAuctionRoom } from "./golf-auction-room";
import { mutateGolfDocument } from "./golf-document-store";
import { readAuctionRoom } from "./golf-auction-store";
import { saveGolfTeamLineup } from "./golf-lineup-store";
import { writeGolfLeagueSnapshot } from "./golf-store";
import type { LeagueSnapshot } from "./data";

const mocks = vi.hoisted(() => ({ league: vi.fn(), acl: vi.fn() }));
vi.mock("@/lib/data", () => ({ getLeagueSnapshot: mocks.league }));
vi.mock("@/lib/session", () => ({ requireSession: async () => ({ user: {} }) }));
vi.mock("@/lib/franchise-acl", () => ({
  enforceAuctionControl: mocks.acl, enforceAuctionFinalize: mocks.acl, enforceTeamAction: mocks.acl,
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
import { POST as action } from "../app/api/golf/leagues/[leagueId]/auction/actions/route";
import { GET as poll, POST as createRoom } from "../app/api/golf/leagues/[leagueId]/auction/route";
import { POST as lineupPost } from "../app/api/golf/leagues/[leagueId]/lineups/route";

type Stored = { generation: number; value: unknown };
let root: string;
let documents: Map<string, Stored>;
let writes: number;
let pauseMedia: (() => Promise<void>) | undefined;
const roomKey = "golf-race/2026/auction_room.json";
const lineupKey = "golf-race/2026/lineups.json";
const props = () => ({ params: Promise.resolve({ leagueId: "golf-race" }) });
function request(body: unknown) {
  return new Request("http://localhost/api/golf?season=2026", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
function seed(key: string, value: unknown) {
  documents.set(key, { generation: 1, value: structuredClone(value) });
}
function league() {
  return buildGolfSnapshot({
    league_id: "golf-race", name: "Race tests", season: 2026, format: "h2h", team_count: 6,
    bench: 2, missed_cut: "off", draft_style: "snake", keepers: false,
    multipliers: { regular: 1, signature: 1.5, major: 2 },
  }) as unknown as LeagueSnapshot;
}
function bidding() {
  const now = new Date();
  return nominatePlayer(startAuctionRoom(createAuctionRoom({
    league_id: "golf-race", season: 2026, team_ids: [1, 2], team_names: {},
    budget: 100, starters: 1, bench: 0, now, bid_window_ms: 60_000, bid_hard_cap_ms: 120_000,
  }), now), 1, 1, now);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "sj-golf-race-"));
  vi.stubEnv("SJ_HUB_DIR", root);
  vi.stubEnv("SJ_HUB_GCS_BUCKET", "offline-test-bucket");
  vi.stubEnv("K_SERVICE", "offline-test-service");
  mocks.acl.mockReset().mockResolvedValue(null);
  mocks.league.mockReset();
  documents = new Map(); writes = 0; pauseMedia = undefined;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "metadata.google.internal") {
      return Response.json({ access_token: "offline-fixture", expires_in: 3600 });
    }
    expect(url.hostname).toBe("storage.googleapis.com");
    if (init?.method === "POST") {
      const key = url.searchParams.get("name")!;
      const previous = documents.get(key);
      if (String(previous?.generation ?? 0) !== url.searchParams.get("ifGenerationMatch")) {
        return new Response(null, { status: 412 });
      }
      documents.set(key, { generation: (previous?.generation ?? 0) + 1, value: JSON.parse(init.body as string) });
      writes++;
      return Response.json({});
    }
    const key = decodeURIComponent(url.pathname.split("/o/")[1]);
    const doc = documents.get(key);
    if (!doc) return new Response(null, { status: 404 });
    if (url.searchParams.get("alt") === "media") {
      if (String(doc.generation) !== url.searchParams.get("ifGenerationMatch")) return new Response(null, { status: 412 });
      const value = structuredClone(doc.value);
      const pause = pauseMedia; pauseMedia = undefined;
      if (pause) await pause();
      return Response.json(value);
    }
    return Response.json({ generation: String(doc.generation) });
  }));
});
afterEach(async () => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  const target = path.resolve(root);
  if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith("sj-golf-race-")) {
    throw new Error("refusing to remove a path outside this test's temporary directory");
  }
  await fs.rm(target, { recursive: true, force: true });
});

describe("authoritative conditional golf writes", () => {
  it("initializes a missing room once when creation requests overlap", async () => {
    const snapshot = league();
    snapshot.settings!.golf = { ...(snapshot.settings!.golf as object), draft: { style: "auction", budget: 100 } };
    snapshot.draft = [];
    mocks.league.mockResolvedValue(snapshot);
    const responses = await Promise.all([createRoom(request({ season: 2026 }), props()), createRoom(request({ season: 2026 }), props())]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 201]);
    expect(writes).toBe(1);
  });

  it("accepts only one of two bids from the same revision", async () => {
    const room = bidding(); seed(roomKey, room);
    const responses = await Promise.all([
      action(request({ action: "bid", season: 2026, revision: room.revision, team_id: 2, amount: 10 }), props()),
      action(request({ action: "bid", season: 2026, revision: room.revision, team_id: 1, amount: 5 }), props()),
    ]);
    expect(responses.map(r => r.status)).toEqual([200, 409]);
    expect((await readAuctionRoom("golf-race", 2026))?.current?.high_bid).toBe(10);
    expect(writes).toBe(1);
  });

  it("a delayed polling read cannot overwrite an accepted bid", async () => {
    const room = bidding(); seed(roomKey, room);
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    pauseMedia = async () => { entered(); await gate; };
    const polling = poll(new Request("http://localhost/api/golf?season=2026"), props());
    await waiting;
    const bid = await action(request({ action: "bid", season: 2026, revision: room.revision, team_id: 2, amount: 10 }), props());
    expect(bid.status).toBe(200);
    release(); expect((await polling).status).toBe(200);
    expect((await readAuctionRoom("golf-race", 2026))?.current?.high_bid).toBe(10);
    expect(writes).toBe(1);
  });

  it("concurrent timer polls sell a lot only once", async () => {
    const room = bidding();
    room.current!.bid_ends_at = "2000-01-01T00:00:00Z";
    room.current!.high_bid = 5; room.current!.high_bidder_team_id = 2;
    seed(roomKey, room);
    await Promise.all([readAuctionRoom("golf-race", 2026), readAuctionRoom("golf-race", 2026)]);
    const final = await readAuctionRoom("golf-race", 2026);
    expect(final?.picks).toHaveLength(1);
    expect(final?.budgets["2"]).toBe(95);
    expect(writes).toBe(1);
  });

  it("keeps concurrent team submissions despite the same stale cached league", async () => {
    const snapshot = league();
    for (const event of snapshot.lineups!.events) {
      event.tee_times = Object.fromEntries(snapshot.teams.flatMap(t => t.roster.map(p => [String(p.id), "2099-01-01T00:00:00Z"])));
    }
    seed("golf-race/2026/manifest.json", {}); seed(lineupKey, snapshot.lineups);
    mocks.league.mockResolvedValue(snapshot);
    const eventId = snapshot.lineups!.events[0].event_id;
    const bodies = [1, 2].map(id => {
      const lined = snapshot.lineups!.teams[String(id)][eventId];
      return { season: 2026, team_id: id, event_id: eventId, starters: lined.starters, captain: lined.starters[1] };
    });
    expect((await Promise.all(bodies.map(body => lineupPost(request(body), props())))).map(r => r.status)).toEqual([200, 200]);
    const final = documents.get(lineupKey)!.value as typeof snapshot.lineups;
    for (const body of bodies) expect(final!.teams[String(body.team_id)][eventId].captain).toBe(body.captain);
    expect(writes).toBe(2);
  });

  it("revalidates tee locks against current persisted lineup data", async () => {
    const snapshot = league(); const current = structuredClone(snapshot.lineups!);
    const event = current.events[0]; const lined = current.teams["1"][event.event_id];
    event.tee_times = { [String(lined.captain)]: "2000-01-01T00:00:00Z" };
    seed("golf-race/2026/manifest.json", {}); seed(lineupKey, current);
    mocks.league.mockResolvedValue(snapshot);
    const response = await lineupPost(request({ season: 2026, team_id: 1, event_id: event.event_id,
      starters: lined.starters, captain: lined.starters[1] }), props());
    expect(response.status).toBe(400); expect(writes).toBe(0);
  });

  it("does not fall back to unsafe FUSE writes when Cloud Run lacks bucket configuration", async () => {
    vi.stubEnv("SJ_HUB_GCS_BUCKET", "");
    await expect(mutateGolfDocument("a.json", () => ({ value: {}, result: true }))).rejects.toThrow("SJ_HUB_GCS_BUCKET");
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("fails closed on storage permission errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
    await expect(mutateGolfDocument("a.json", () => ({ value: {}, result: true }))).rejects.toThrow();
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("does not read or mutate a room when team authorization fails", async () => {
    mocks.acl.mockResolvedValue(Response.json({ error: "denied" }, { status: 403 }));
    const response = await action(request({ action: "bid", season: 2026, revision: 1, team_id: 2, amount: 10 }), props());
    expect(response.status).toBe(403); expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds repeated generation conflicts without falling back to unconditional writes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === "metadata.google.internal") return Response.json({ access_token: "offline", expires_in: 3600 });
      if (init?.method === "POST") return new Response(null, { status: 412 });
      return new Response(null, { status: 404 });
    }));
    await expect(mutateGolfDocument("a.json", () => ({ value: {}, result: true }))).rejects.toThrow("changed too often");
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(12);
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("serializes local writers and releases the lock after a rejected mutation", async () => {
    vi.stubEnv("K_SERVICE", ""); vi.stubEnv("SJ_HUB_GCS_BUCKET", "");
    await Promise.all(Array.from({ length: 12 }, () => mutateGolfDocument<{ n: number }, void>("count.json",
      current => ({ value: { n: (current?.n ?? 0) + 1 }, result: undefined }))));
    await expect(mutateGolfDocument("count.json", () => { throw new Error("denied"); })).rejects.toThrow("denied");
    const count = await mutateGolfDocument<{ n: number }, number>("count.json", current => ({ result: current!.n }));
    expect(count).toBe(12); expect((await fs.readdir(root)).filter(f => f.endsWith(".lock"))).toEqual([]);
  });

  it("initializes fixture-backed seasons and preserves submissions during finalize retries", async () => {
    vi.stubEnv("K_SERVICE", ""); vi.stubEnv("SJ_HUB_GCS_BUCKET", "");
    const snapshot = league(); const eventId = snapshot.lineups!.events[0].event_id;
    const original = snapshot.lineups!.teams["1"][eventId];
    const submitted = { ...original, captain: original.starters[1] };
    await saveGolfTeamLineup({ league: snapshot, teamId: 1, eventId, prepare: () => submitted });
    await writeGolfLeagueSnapshot(snapshot as Parameters<typeof writeGolfLeagueSnapshot>[0], { preserveLineups: true });
    const final = JSON.parse(await fs.readFile(path.join(root, lineupKey), "utf8"));
    expect(final.teams["1"][eventId].captain).toBe(submitted.captain);
    const manifest = JSON.parse(await fs.readFile(path.join(root, "golf-race/2026/manifest.json"), "utf8"));
    expect(manifest.league_id).toBe("golf-race");
  });

  it("replaces lineups consistently during explicit same-season recreation", async () => {
    vi.stubEnv("K_SERVICE", ""); vi.stubEnv("SJ_HUB_GCS_BUCKET", "");
    const original = league();
    await writeGolfLeagueSnapshot(original as Parameters<typeof writeGolfLeagueSnapshot>[0]);
    const replacement = buildGolfSnapshot({ league_id: "golf-race", name: "Recreated", season: 2026,
      format: "h2h", team_count: 8, bench: 2, missed_cut: "off", draft_style: "snake", keepers: false,
      multipliers: { regular: 1, signature: 1.5, major: 2 } });
    await writeGolfLeagueSnapshot(replacement);
    const persisted = JSON.parse(await fs.readFile(path.join(root, lineupKey), "utf8"));
    expect(Object.keys(persisted.teams)).toHaveLength(8);
    for (const team of replacement.teams) {
      const roster = new Set(team.roster.map(p => p.id));
      for (const lined of Object.values(persisted.teams[String(team.team_id)]) as Array<{ starters: number[] }>) {
        expect(lined.starters.every(id => roster.has(id))).toBe(true);
      }
    }
  });

  it("rejects incompatible preservation before replacing other concerns", async () => {
    vi.stubEnv("K_SERVICE", ""); vi.stubEnv("SJ_HUB_GCS_BUCKET", "");
    const original = league();
    await writeGolfLeagueSnapshot(original as Parameters<typeof writeGolfLeagueSnapshot>[0]);
    const replacement = { ...original, teams: original.teams.slice(0, 4) };
    await expect(writeGolfLeagueSnapshot(replacement as Parameters<typeof writeGolfLeagueSnapshot>[0],
      { preserveLineups: true })).rejects.toThrow("different roster");
    const persisted = JSON.parse(await fs.readFile(path.join(root, "golf-race/2026/standings.json"), "utf8"));
    expect(persisted.teams).toHaveLength(6);
  });
});
