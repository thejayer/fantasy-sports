import { describe, expect, it } from "vitest";

import {
  emptyMembersFile,
  memberAvatarUrl,
  memberImageMap,
  setMemberAvatarUrl,
  setMemberImageUrl,
} from "./hub-members";

describe("member avatar override (Profile & settings)", () => {
  const google = "https://lh3.googleusercontent.com/a/photo";
  const custom = "https://example.com/me.png";

  it("custom avatar wins over the Google photo and survives sign-in sync", () => {
    let file = setMemberImageUrl(emptyMembersFile(), "jay@example.com", google);
    file = setMemberAvatarUrl(file, "jay@example.com", custom);
    file = setMemberImageUrl(file, "jay@example.com", `${google}?v=2`);
    expect(file.members[0]?.avatar_url).toBe(custom);
    expect(memberAvatarUrl(file.members[0])).toBe(custom);
    expect(memberImageMap(file)).toEqual({ "jay@example.com": custom });
  });

  it("empty string clears back to the Google photo; rejects http", () => {
    let file = setMemberImageUrl(emptyMembersFile(), "jay@example.com", google);
    file = setMemberAvatarUrl(file, "jay@example.com", custom);
    file = setMemberAvatarUrl(file, "jay@example.com", "");
    expect(file.members[0]?.avatar_url).toBeUndefined();
    expect(memberAvatarUrl(file.members[0])).toBe(google);
    expect(() => setMemberAvatarUrl(file, "jay@example.com", "http://x.test/a.png")).toThrow(/https/);
  });
});
