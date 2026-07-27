import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `requireSession` is wrapped in React `cache()`, so each test imports a fresh
 * module instance to avoid memoised results leaking between cases.
 */

const authMock = vi.fn();
const redirectMock = vi.fn((target: string) => {
  // Mirror the real redirect(), which signals by throwing.
  throw new Error(`NEXT_REDIRECT:${target}`);
});

vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("next/navigation", () => ({ redirect: (target: string) => redirectMock(target) }));

async function loadSessionModule() {
  vi.resetModules();
  return import("@/lib/session");
}

beforeEach(() => {
  authMock.mockReset();
  redirectMock.mockClear();
  delete process.env.AUTH_DEV_BYPASS;
});

afterEach(() => {
  delete process.env.AUTH_DEV_BYPASS;
});

describe("requireSession", () => {
  it("returns the session for a signed-in user", async () => {
    const session = { user: { email: "member@example.com" } };
    authMock.mockResolvedValue(session);

    const { requireSession } = await loadSessionModule();
    await expect(requireSession()).resolves.toEqual(session);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to /login when there is no session", async () => {
    authMock.mockResolvedValue(null);

    const { requireSession } = await loadSessionModule();
    await expect(requireSession()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("redirects when a session exists but carries no user", async () => {
    authMock.mockResolvedValue({ expires: "soon" });

    const { requireSession } = await loadSessionModule();
    await expect(requireSession()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("skips the check entirely under AUTH_DEV_BYPASS", async () => {
    process.env.AUTH_DEV_BYPASS = "1";

    const { requireSession } = await loadSessionModule();
    await expect(requireSession()).resolves.toBeNull();
    expect(authMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("does not treat other AUTH_DEV_BYPASS values as enabled", async () => {
    process.env.AUTH_DEV_BYPASS = "0";
    authMock.mockResolvedValue(null);

    const { requireSession } = await loadSessionModule();
    await expect(requireSession()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(authMock).toHaveBeenCalled();
  });
});

describe("data layer gating", () => {
  it("guards both snapshot entry points", async () => {
    // Reading the source is the reliable assertion here: importing data.ts
    // pulls in the fs-backed module, and what matters is that neither door to
    // league data can be opened without the check.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const source = readFileSync(
      path.resolve(__dirname, "data.ts"),
      "utf8",
    );

    const guarded = source.match(/await requireSession\(\)/g) ?? [];
    expect(guarded.length).toBe(2);
    expect(source).toMatch(/getLeagueIndex = cache\(async \(\)[^{]*\{\s*await requireSession\(\)/);
    expect(source).toMatch(/await requireSession\(\);\s*const index = await getLeagueIndex\(\)/);
  });
});
