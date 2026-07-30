import { describe, expect, it } from "vitest";

import {
  assertCanActAsTeam,
  assertCanControlAuction,
  assertCanFinalizeAuction,
  canAccessAdmin,
  effectiveAllowlist,
  emptyMembersFile,
  golfActingScope,
  normalizeEmail,
  removeMember,
  setMemberTeams,
  upsertMember,
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

  it("enforces franchise ACL for team actions", () => {
    let file = upsertMember(emptyMembersFile(), {
      email: "owner@example.com",
      role: "member",
    });
    file = setMemberTeams(file, "owner@example.com", [
      { league_id: "golf-main", team_id: 2, team_name: "Birdies" },
    ]);
    const ctx = {
      email: "owner@example.com",
      file,
      leagueId: "golf-main",
    };
    expect(assertCanActAsTeam({ ...ctx, teamId: 2 })).toEqual({
      ok: true,
      mode: "linked",
    });
    expect(assertCanActAsTeam({ ...ctx, teamId: 1 }).ok).toBe(false);
    expect(assertCanControlAuction(ctx).ok).toBe(true);
    expect(assertCanFinalizeAuction(ctx).ok).toBe(false);

    const adminFile = upsertMember(file, {
      email: "boss@example.com",
      role: "admin",
    });
    expect(
      assertCanActAsTeam({
        email: "boss@example.com",
        file: adminFile,
        leagueId: "golf-main",
        teamId: 99,
      }),
    ).toEqual({ ok: true, mode: "bypass" });
    expect(
      assertCanFinalizeAuction({
        email: "boss@example.com",
        file: adminFile,
        leagueId: "golf-main",
      }).ok,
    ).toBe(true);

    expect(
      assertCanActAsTeam({
        email: "owner@example.com",
        file,
        leagueId: "golf-main",
        teamId: 1,
        devBypass: true,
      }).mode,
    ).toBe("bypass");

    const scope = golfActingScope(ctx, [1, 2, 3]);
    expect(scope.allowedTeamIds).toEqual([2]);
    expect(scope.canFinalizeAuction).toBe(false);
  });
});
