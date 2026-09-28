import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actorMock = vi.fn();

vi.mock("@/lib/session", () => ({
  getFitnessActor: () => actorMock(),
}));

async function loadRoute() {
  vi.resetModules();
  return import("./route");
}

describe("GET/PUT /api/me isolation", () => {
  beforeEach(async () => {
    actorMock.mockReset();
    process.env.SJ_FITNESS_DIR = await mkdtemp(path.join(tmpdir(), "sj-fit-api-"));
  });

  afterEach(() => {
    delete process.env.SJ_FITNESS_DIR;
  });

  it("rejects anonymous reads and writes", async () => {
    actorMock.mockResolvedValue(null);
    const { GET, PUT } = await loadRoute();
    const getRes = await GET();
    expect(getRes.status).toBe(401);
    const putRes = await PUT(
      new Request("http://fitness.test/api/me", {
        method: "PUT",
        body: JSON.stringify({ slices: { sessions: [{ id: "x" }] } }),
      }),
    );
    expect(putRes.status).toBe(401);
  });

  it("does not return Ada's sessions to Bob even if Bob asks for her email", async () => {
    const { GET, PUT } = await loadRoute();

    actorMock.mockResolvedValue({
      email: "ada@sj.com",
      name: "Ada",
      image: null,
      source: "session",
    });
    const write = await PUT(
      new Request("http://fitness.test/api/me", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slices: { sessions: [{ id: "ada-only" }] },
        }),
      }),
    );
    expect(write.status).toBe(200);

    actorMock.mockResolvedValue({
      email: "bob@sj.com",
      name: "Bob",
      image: null,
      source: "session",
    });
    const spoof = await PUT(
      new Request("http://fitness.test/api/me", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "ada@sj.com",
          userId: "ada@sj.com",
          slices: { sessions: [{ id: "bob-trying-ada" }] },
        }),
      }),
    );
    expect(spoof.status).toBe(200);
    const spoofBody = (await spoof.json()) as {
      user: { email: string };
      document: { email: string; slices: { sessions: Array<{ id: string }> } };
    };
    expect(spoofBody.user.email).toBe("bob@sj.com");
    expect(spoofBody.document.email).toBe("bob@sj.com");
    expect(spoofBody.document.slices.sessions).toEqual([{ id: "bob-trying-ada" }]);

    const bobGet = await GET();
    const bobBody = (await bobGet.json()) as {
      document: { slices: { sessions: Array<{ id: string }> } };
    };
    expect(JSON.stringify(bobBody)).not.toContain("ada-only");

    actorMock.mockResolvedValue({
      email: "ada@sj.com",
      name: "Ada",
      image: null,
      source: "session",
    });
    const adaGet = await GET();
    const adaBody = (await adaGet.json()) as {
      document: { slices: { sessions: Array<{ id: string }> } };
    };
    expect(adaBody.document.slices.sessions).toEqual([{ id: "ada-only" }]);
    expect(JSON.stringify(adaBody)).not.toContain("bob-trying-ada");
  });
});
