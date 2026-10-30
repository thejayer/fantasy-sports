import { beforeEach, describe, expect, it, vi } from "vitest";

const getCasinoMember = vi.fn();
const getCasinoSummary = vi.fn();

vi.mock("@/lib/casino-member", () => ({ getCasinoMember: () => getCasinoMember() }));
vi.mock("@/lib/casino-summary", () => ({
  getCasinoSummary: (deps: unknown) => getCasinoSummary(deps),
}));

import { GET } from "./route";

const SUMMARY = { date: "2026-10-30", top: [], hot: [], players: 0 };

describe("GET /casino/portal-summary", () => {
  beforeEach(() => {
    vi.stubEnv("CASINO_URL", "https://casino.example");
    getCasinoMember.mockReset();
    getCasinoSummary.mockReset();
  });

  it("is a 404 when the casino is not configured", async () => {
    vi.stubEnv("CASINO_URL", "");
    const res = await GET();
    expect(res.status).toBe(404);
    expect(getCasinoSummary).not.toHaveBeenCalled();
  });

  it("is a bare 401 when signed out, and never asks the casino", async () => {
    getCasinoMember.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(getCasinoSummary).not.toHaveBeenCalled();
  });

  it("returns the summary privately cached for 30 s", async () => {
    getCasinoMember.mockResolvedValue({ id: "m1" });
    getCasinoSummary.mockResolvedValue(SUMMARY);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=30");
    expect(await res.json()).toEqual(SUMMARY);
  });

  it("is a 503 (not cached) when the casino can't supply one", async () => {
    getCasinoMember.mockResolvedValue({ id: "m1" });
    getCasinoSummary.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
