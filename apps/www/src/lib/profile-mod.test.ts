import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/casino-member", () => ({ getCasinoMember: async () => null }));

import { isCasinoMod } from "./profile-mod";

const base = {
  upstream: "https://casino.example",
  authMode: "none",
  getMember: async () => ({ id: "1234567890", name: "Pat" }),
};

describe("isCasinoMod", () => {
  it("is true only when the casino says mod:true", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ mod: true, links: [], taken: [] }));
    expect(await isCasinoMod({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch })).toBe(true);
    const target = (fetchImpl.mock.calls[0] as unknown as [URL])[0];
    expect(target.pathname).toBe("/casino/api/links");
    expect(target.origin).toBe("https://casino.example");
  });

  it("is false for a plain member", async () => {
    const fetchImpl = async () => Response.json({ mod: false, links: [], taken: [] });
    expect(await isCasinoMod({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch })).toBe(false);
  });

  it("fails closed on errors, junk and a signed-out member", async () => {
    const f = (impl: () => Promise<Response>) => ({ ...base, fetchImpl: impl as unknown as typeof fetch });
    expect(await isCasinoMod(f(async () => new Response("no", { status: 500 })))).toBe(false);
    expect(await isCasinoMod(f(async () => new Response("<html>", { status: 200 })))).toBe(false);
    expect(await isCasinoMod(f(async () => Response.json({ mod: "true" })))).toBe(false);
    expect(await isCasinoMod(f(async () => Promise.reject(new Error("down"))))).toBe(false);
    expect(await isCasinoMod({ ...base, getMember: async () => null })).toBe(false);
  });

  it("is false when the casino proxy is off", async () => {
    expect(await isCasinoMod({ ...base, upstream: null })).toBe(false);
  });
});
