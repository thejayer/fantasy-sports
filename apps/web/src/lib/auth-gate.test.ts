import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readHubMembers = vi.fn();

vi.mock("@/lib/hub-members-store", () => ({
  readHubMembers: () => readHubMembers(),
}));

async function loadGate() {
  vi.resetModules();
  return import("./auth-gate");
}

beforeEach(() => {
  readHubMembers.mockReset();
  readHubMembers.mockResolvedValue(null);
  delete process.env.ALLOWED_EMAILS;
  delete process.env.AUTH_DEV_BYPASS;
});

afterEach(() => {
  delete process.env.ALLOWED_EMAILS;
  delete process.env.AUTH_DEV_BYPASS;
});

describe("allowGoogleSignIn", () => {
  it("admits an ALLOWED_EMAILS address", async () => {
    process.env.ALLOWED_EMAILS = "ada@sj.com";
    const { allowGoogleSignIn } = await loadGate();
    await expect(allowGoogleSignIn("Ada@SJ.com")).resolves.toBe(true);
  });

  it("denies a stranger even when AUTH_DEV_BYPASS=1", async () => {
    process.env.ALLOWED_EMAILS = "ada@sj.com";
    process.env.AUTH_DEV_BYPASS = "1";
    const { allowGoogleSignIn } = await loadGate();
    await expect(allowGoogleSignIn("eve@gmail.com")).resolves.toBe(false);
  });

  it("denies a missing profile email even under bypass", async () => {
    process.env.AUTH_DEV_BYPASS = "1";
    const { allowGoogleSignIn } = await loadGate();
    await expect(allowGoogleSignIn(undefined)).resolves.toBe(false);
  });
});
