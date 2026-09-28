import { describe, expect, it } from "vitest";

import {
  emptyMembersFile,
  memberFranchises,
  upsertMember,
  type HubMembersFile,
} from "@/lib/hub-members";

function fileWith(
  email: string,
  teams: Array<{ league_id: string; team_id: number; team_name?: string }>,
): HubMembersFile {
  return upsertMember(emptyMembersFile(), { email, teams });
}

describe("memberFranchises (roadmap 7.1)", () => {
  it("returns every linked franchise for the member", () => {
    const file = fileWith("a@example.com", [
      { league_id: "football-main", team_id: 4, team_name: "Gridiron Goons" },
      { league_id: "baseball-dynasty", team_id: 7 },
    ]);
    const links = memberFranchises(file, "a@example.com");
    expect(links.map((l) => [l.league_id, l.team_id])).toEqual([
      ["football-main", 4],
      ["baseball-dynasty", 7],
    ]);
  });

  it("matches case-insensitively on email", () => {
    const file = fileWith("Mixed@Example.com", [
      { league_id: "football-main", team_id: 2 },
    ]);
    expect(memberFranchises(file, "MIXED@EXAMPLE.COM")).toHaveLength(1);
  });

  it("is empty for an unknown member, a null email, or a null file", () => {
    const file = fileWith("a@example.com", [
      { league_id: "football-main", team_id: 4 },
    ]);
    expect(memberFranchises(file, "b@example.com")).toEqual([]);
    expect(memberFranchises(file, null)).toEqual([]);
    expect(memberFranchises(null, "a@example.com")).toEqual([]);
  });

  it("is empty for a member with no links, so the UI stays non-personalised", () => {
    const file = fileWith("a@example.com", []);
    expect(memberFranchises(file, "a@example.com")).toEqual([]);
  });

  it("keeps one franchise per league when a file was hand-edited", () => {
    // upsertMember/setMemberTeams dedupe on write; a hand-edited file could
    // still carry two links for one league and must not flip per render.
    const file: HubMembersFile = {
      schema_version: 1,
      updated_at: new Date().toISOString(),
      members: [
        {
          email: "a@example.com",
          role: "member",
          teams: [
            { league_id: "football-main", team_id: 4 },
            { league_id: "football-main", team_id: 9 },
          ],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    };
    const links = memberFranchises(file, "a@example.com");
    expect(links).toHaveLength(1);
    expect(links[0].team_id).toBe(4);
  });

  it("ignores malformed links rather than throwing", () => {
    const file: HubMembersFile = {
      schema_version: 1,
      updated_at: new Date().toISOString(),
      members: [
        {
          email: "a@example.com",
          role: "member",
          teams: [
            { league_id: "", team_id: 1 },
            // @ts-expect-error deliberately malformed on-disk row
            { league_id: "football-main", team_id: "4" },
            { league_id: "baseball-dynasty", team_id: 3 },
          ],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    };
    expect(memberFranchises(file, "a@example.com")).toEqual([
      { league_id: "baseball-dynasty", team_id: 3 },
    ]);
  });
});
