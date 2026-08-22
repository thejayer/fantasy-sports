import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();

vi.mock("@/auth", () => ({ auth: () => authMock() }));

async function loadSession() {
  vi.resetModules();
  return import("./session");
}

beforeEach(() => {
  authMock.mockReset();
  delete process.env.AUTH_DEV_BYPASS;
  delete process.env.SJ_DEV_VIEWER_EMAIL;
});

afterEach(() => {
  delete process.env.AUTH_DEV_BYPASS;
  delete process.env.SJ_DEV_VIEWER_EMAIL;
});

describe("getFitnessActor", () => {
  it("returns the signed-in Google email", async () => {
    authMock.mockResolvedValue({
      user: { email: "Ada@SJ.com", name: "Ada", image: "https://example.com/a.png" },
    });
    const { getFitnessActor } = await loadSession();
    await expect(getFitnessActor()).resolves.toEqual({
      email: "ada@sj.com",
      name: "Ada",
      image: "https://example.com/a.png",
      source: "session",
    });
  });

  it("returns null when there is no session", async () => {
    authMock.mockResolvedValue(null);
    const { getFitnessActor } = await loadSession();
    await expect(getFitnessActor()).resolves.toBeNull();
  });

  it("uses SJ_DEV_VIEWER_EMAIL under AUTH_DEV_BYPASS", async () => {
    process.env.AUTH_DEV_BYPASS = "1";
    process.env.SJ_DEV_VIEWER_EMAIL = "demo@example.com";
    const { getFitnessActor } = await loadSession();
    await expect(getFitnessActor()).resolves.toMatchObject({
      email: "demo@example.com",
      source: "bypass",
    });
    expect(authMock).not.toHaveBeenCalled();
  });
});
