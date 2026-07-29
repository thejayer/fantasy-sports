import { describe, expect, it } from "vitest";

import {
  canAccessAdmin,
  effectiveAllowlist,
  normalizeEmail,
  removeMember,
  setMemberTeams,
  upsertMember,
  emptyMembersFile,
} from "@/lib/hub-members";

describe("hub-members", () => {
  it("normalizes emails and unions allowlists", () => {
    expect(normalizeEmail("  You@Example.COM ")).toBe("you@example.com");
    const file = upsertMember(emptyMembersFile(), {
      email: "friend@example.com",
    });
    const allow = effectiveAllowlist(["you@example.com"], file);
    expect(allow.has("you@example.com")).toBe(true);
    expect(allow.has("friend@example.com")).toBe(true);
  });

  it("bootstraps admin when no admins exist yet", () => {
    const empty = emptyMembersFile();
    expect(
      canAccessAdmin("you@example.com", empty, {
        envAllowlist: ["you@example.com"],
      }),
    ).toBe(true);
    expect(
      canAccessAdmin("other@example.com", empty, {
        envAllowlist: ["you@example.com"],
      }),
    ).toBe(false);

    const withAdmin = upsertMember(empty, {
      email: "you@example.com",
      role: "admin",
    });
    expect(
      canAccessAdmin("friend@example.com", withAdmin, {
        envAllowlist: ["you@example.com", "friend@example.com"],
      }),
    ).toBe(false);
    expect(canAccessAdmin("you@example.com", withAdmin)).toBe(true);
  });

  it("upserts, links one team per league, and removes", () => {
    let file = upsertMember(emptyMembersFile(), {
      email: "a@b.com",
      role: "member",
    });
    file = setMemberTeams(file, "a@b.com", [
      {
        league_id: "football-main",
        team_id: 3,
        team_name: "Gridiron",
        league_name: "Football",
      },
      {
        league_id: "football-main",
        team_id: 1,
        team_name: "ShouldReplace",
      },
      { league_id: "baseball-dynasty", team_id: 2 },
    ]);
    const member = file.members[0];
    expect(member.teams).toHaveLength(2);
    expect(
      member.teams.find((t) => t.league_id === "football-main")?.team_id,
    ).toBe(1);

    file = removeMember(file, "A@B.com");
    expect(file.members).toHaveLength(0);
  });
});
