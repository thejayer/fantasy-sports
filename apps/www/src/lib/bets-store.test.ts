import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getBetsActor = vi.fn();

vi.mock("@/lib/session", () => ({
  getBetsActor: () => getBetsActor(),
}));

async function loadStore() {
  vi.resetModules();
  return import("./bets-store");
}

beforeEach(() => {
  getBetsActor.mockReset();
});

afterEach(() => {
  getBetsActor.mockReset();
});

describe("getBetsDocument", () => {
  it("returns empty when there is no allowlisted actor", async () => {
    getBetsActor.mockResolvedValue(null);
    const { getBetsDocument } = await loadStore();
    await expect(getBetsDocument()).resolves.toEqual({ bets: [] });
  });
});
