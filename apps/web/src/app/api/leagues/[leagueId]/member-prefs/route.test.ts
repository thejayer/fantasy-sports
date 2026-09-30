import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const viewer = vi.hoisted(() => ({ email: "reed@example.com" as string | null }));

vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => null) }));
vi.mock("@/lib/viewer", () => ({ getViewer: vi.fn(async () => ({ email: viewer.email })) }));
vi.mock("@/lib/data", () => ({
  getLeagueIndex: vi.fn(async () => [
    { league_id: "hockey-main", sport: "hockey", season: 2027 },
    { league_id: "football-main", sport: "football", season: 2026 },
  ]),
}));

import { GET, POST } from "./route";

const params = (leagueId = "hockey-main") => ({ params: Promise.resolve({ leagueId }) });
const post = (body: unknown, leagueId = "hockey-main") =>
  POST(
    new Request(`http://localhost/api/leagues/${leagueId}/member-prefs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    params(leagueId),
  );
const get = () => GET(new Request("http://localhost/api/leagues/hockey-main/member-prefs"), params());

let hub: string;

describe("/api/leagues/{id}/member-prefs", () => {
  beforeEach(() => {
    hub = mkdtempSync(path.join(tmpdir(), "sj-prefs-"));
    process.env.SJ_HUB_DIR = hub;
    viewer.email = "reed@example.com";
  });
  afterEach(() => {
    delete process.env.SJ_HUB_DIR;
    rmSync(hub, { recursive: true, force: true });
  });

  it("needs a signed-in email and a hockey league", async () => {
    viewer.email = null;
    expect((await post({ espn_id: "1", tags: ["Keep"] })).status).toBe(401);
    viewer.email = "reed@example.com";
    expect((await post({ espn_id: "1", tags: ["Keep"] }, "football-main")).status).toBe(404);
    expect((await post({ espn_id: "abc", tags: ["Keep"] })).status).toBe(400);
  });

  it("saves cleaned tags, keeps them private per member, and removes", async () => {
    const saved = await post({ espn_id: "42", tags: ["Keep", "Nope", "PP1"], note: " mine " });
    expect(saved.status).toBe(200);
    expect((await saved.json()).player).toEqual({ tags: ["PP1", "Keep"], note: "mine" });
    expect((await (await get()).json()).players["42"].tags).toEqual(["PP1", "Keep"]);

    // Another member sees nothing of Reed's.
    viewer.email = "austin@example.com";
    expect((await (await get()).json()).players).toEqual({});

    viewer.email = "REED@example.com"; // same member, any case
    await post({ espn_id: "42", tags: [], note: "" });
    expect((await (await get()).json()).players).toEqual({});
  });
});
