import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deny: vi.fn(),
  deliver: vi.fn(),
  sent: [] as string[],
}));

vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => null) }));
vi.mock("@/lib/franchise-acl", () => ({ enforceFeedModerate: mocks.deny }));
vi.mock("@/lib/digest-transport", () => ({ deliverDigestToDiscord: mocks.deliver }));
vi.mock("@/lib/hockey-injury-digest-store", () => ({
  readInjuryDigest: vi.fn(async () => ({ sent: [...mocks.sent] })),
  markInjuriesSent: vi.fn(async (_l: string, _s: number, ids: string[]) => {
    mocks.sent.push(...ids);
  }),
}));
vi.mock("@/lib/data", () => ({
  getLeagueSnapshot: vi.fn(async () => ({
    league_id: "hockey-main",
    season: 2027,
    name: "SJ Hockey",
    sport: "hockey",
    teams: [{ team_id: 1, name: "Five Hole Heroes", roster: [] }],
  })),
  getHockeyInjuryLog: vi.fn(async () => ({
    league_id: "hockey-main",
    season: 2027,
    updated_at: "2026-10-10T11:00:00+00:00",
    baseline: false,
    players: {},
    events: [
      { id: "1:a", at: "2026-10-10T11:00:00+00:00", espn_id: "1", name: "P1", team_id: 1, nhl_team: "BOS",
        kind: "hurt", from: "healthy", to: "out", espn: "OUT", dfo: null, source: "sync" },
    ],
  })),
}));

import { POST } from "./route";

const call = () =>
  POST(
    new Request("http://localhost/api/leagues/hockey-main/injury-digest", {
      method: "POST",
      body: JSON.stringify({ season: 2027 }),
    }),
    { params: Promise.resolve({ leagueId: "hockey-main" }) },
  );

describe("POST /api/leagues/{id}/injury-digest", () => {
  beforeEach(() => {
    mocks.deny.mockResolvedValue(null);
    mocks.deliver.mockResolvedValue({ ok: true, channel: "discord", status: 204 });
    mocks.sent.length = 0;
  });
  afterEach(() => {
    delete process.env.SJ_HOCKEY_INJURY_DISCORD;
    vi.clearAllMocks();
  });

  it("is off by default", async () => {
    const res = await call();
    expect(res.status).toBe(409);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("is admin-only", async () => {
    process.env.SJ_HOCKEY_INJURY_DISCORD = "1";
    mocks.deny.mockResolvedValue(new Response("forbidden", { status: 403 }));
    expect((await call()).status).toBe(403);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("posts new injury news once", async () => {
    process.env.SJ_HOCKEY_INJURY_DISCORD = "1";
    const first = await call();
    expect(first.status).toBe(200);
    expect((await first.json()).sent).toBe(1);
    expect(mocks.deliver.mock.calls[0]![0]).toContain("**P1** (Five Hole Heroes) is out");

    const second = await call();
    expect((await second.json()).sent).toBe(0);
    expect(mocks.deliver).toHaveBeenCalledTimes(1);
  });
});
