import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const readHubMembers = vi.fn();

vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/members-store", () => ({
  readHubMembers: () => readHubMembers(),
}));

async function loadSession() {
  vi.resetModules();
  return import("./session");
}

beforeEach(() => {
  authMock.mockReset();
  readHubMembers.mockReset();
  readHubMembers.mockResolvedValue(null);
  delete process.env.AUTH_DEV_BYPASS;
  delete process.env.SJ_DEV_VIEWER_EMAIL;
  delete process.env.ALLOWED_EMAILS;
});

afterEach(() => {
  delete process.env.AUTH_DEV_BYPASS;
  delete process.env.SJ_DEV_VIEWER_EMAIL;
  delete process.env.ALLOWED_EMAILS;
});

describe("getBetsActor", () => {
  it("returns the signed-in Google email when it is allowlisted", async () => {
    process.env.ALLOWED_EMAILS = "ada@sj.com";
    authMock.mockResolvedValue({
      user: { email: "Ada@SJ.com", name: "Ada", image: "https://example.com/a.png" },
    });
    const { getBetsActor } = await loadSession();
    await expect(getBetsActor()).resolves.toEqual({
      email: "ada@sj.com",
      name: "Ada",
      image: "https://example.com/a.png",
      source: "session",
    });
  });

  it("returns null when there is no session", async () => {
    authMock.mockResolvedValue(null);
    const { getBetsActor } = await loadSession();
    await expect(getBetsActor()).resolves.toBeNull();
  });

  it("rejects a session email that is no longer on the allowlist", async () => {
    process.env.ALLOWED_EMAILS = "ada@sj.com";
    authMock.mockResolvedValue({
      user: { email: "eve@gmail.com", name: "Eve" },
    });
    const { getBetsActor } = await loadSession();
    await expect(getBetsActor()).resolves.toBeNull();
  });

  it("re-checks hub_members.json on each request", async () => {
    readHubMembers.mockResolvedValue({ members: [{ email: "file@sj.com" }] });
    authMock.mockResolvedValue({
      user: { email: "file@sj.com", name: "File" },
    });
    const { getBetsActor } = await loadSession();
    await expect(getBetsActor()).resolves.toMatchObject({
      email: "file@sj.com",
      source: "session",
    });
  });

  it("uses SJ_DEV_VIEWER_EMAIL under AUTH_DEV_BYPASS", async () => {
    process.env.AUTH_DEV_BYPASS = "1";
    process.env.SJ_DEV_VIEWER_EMAIL = "demo@example.com";
    const { getBetsActor } = await loadSession();
    await expect(getBetsActor()).resolves.toMatchObject({
      email: "demo@example.com",
      source: "bypass",
    });
    expect(authMock).not.toHaveBeenCalled();
  });
});
