import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  effectiveAllowlist,
  emptyMembersFile,
  removeMember,
  upsertMember,
  type HubMembersFile,
} from "@/lib/hub-members";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getViewer: vi.fn(),
  updateHubMembers: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.requireSession,
  devBypassEnabled: () => process.env.AUTH_DEV_BYPASS === "1",
}));
vi.mock("@/lib/viewer", () => ({ getViewer: mocks.getViewer }));
vi.mock("@/lib/hub-members-store", () => ({
  updateHubMembers: mocks.updateHubMembers,
}));

import { PATCH } from "./route";

const email = "member@example.com";
let file: HubMembersFile;
let writes: number;

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("ALLOWED_EMAILS", "");
  vi.stubEnv("AUTH_DEV_BYPASS", "0");
  vi.clearAllMocks();
  file = upsertMember(emptyMembersFile(), { email });
  writes = 0;
  mocks.requireSession.mockResolvedValue({ user: { email } });
  mocks.getViewer.mockResolvedValue({ email, name: "Member" });
  mocks.updateHubMembers.mockImplementation(
    async (mutator: (current: HubMembersFile) => HubMembersFile) => {
      const next = mutator(file);
      file = next;
      writes += 1;
      return next;
    },
  );
});

afterEach(() => vi.unstubAllEnvs());

describe("PATCH /api/profile membership", () => {
  it.each([
    { bio: "A new bio" },
    { display_name: "NewName" },
    { avatar_url: "https://example.com/avatar.png" },
  ])("rejects a removed member editing %j despite a valid session", async (body) => {
    file = removeMember(file, email);

    const response = await PATCH(request(body));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "membership required" });
    expect(file.members).toEqual([]);
    expect(effectiveAllowlist([], file).has(email)).toBe(false);
    expect(writes).toBe(0);
  });

  it("checks removal after resolving the viewer, inside the queued mutation", async () => {
    mocks.updateHubMembers.mockImplementationOnce(
      async (mutator: (current: HubMembersFile) => HubMembersFile) => {
        file = removeMember(file, email);
        const next = mutator(file);
        file = next;
        writes += 1;
        return next;
      },
    );

    const response = await PATCH(request({ bio: "Cannot restore access" }));

    expect(response.status).toBe(403);
    expect(file.members).toEqual([]);
    expect(writes).toBe(0);
  });

  it("lets a current member update all profile fields", async () => {
    const response = await PATCH(request({
      bio: "Still a member",
      display_name: "CurrentMember",
      avatar_url: "https://example.com/avatar.png",
    }));

    expect(response.status).toBe(200);
    expect(file.members[0]).toMatchObject({
      email,
      bio: "Still a member",
      display_name: "CurrentMember",
      avatar_url: "https://example.com/avatar.png",
    });
    expect(writes).toBe(1);
  });

  it("allows an environment-allowlisted user without a member row", async () => {
    file = emptyMembersFile();
    vi.stubEnv("ALLOWED_EMAILS", " Member@Example.com ");
    mocks.getViewer.mockResolvedValue({ email: "Member@Example.com", name: "Member" });

    const response = await PATCH(request({ bio: "Explicitly allowed" }));

    expect(response.status).toBe(200);
    expect(file.members[0]).toMatchObject({ email, bio: "Explicitly allowed" });
  });

  it("does not admit a removed user because another email is allowlisted", async () => {
    file = removeMember(file, email);
    vi.stubEnv("ALLOWED_EMAILS", "other@example.com");

    expect((await PATCH(request({ bio: "Denied" }))).status).toBe(403);
    expect(writes).toBe(0);
  });

  it("preserves explicit local development bypass", async () => {
    file = emptyMembersFile();
    vi.stubEnv("AUTH_DEV_BYPASS", "1");

    expect((await PATCH(request({ bio: "Local demo" }))).status).toBe(200);
    expect(file.members[0]).toMatchObject({ email, bio: "Local demo" });
  });
});
