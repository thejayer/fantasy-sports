import { describe, expect, it } from "vitest";

import {
  effectiveAllowlist,
  isEmailAllowed,
  normalizeEmail,
  parseAllowedEmailsEnv,
} from "./allowlist";

describe("allowlist", () => {
  it("normalizes and splits ALLOWED_EMAILS", () => {
    expect(parseAllowedEmailsEnv(" Ada@Sj.com, bob@sj.com ,")).toEqual([
      "ada@sj.com",
      "bob@sj.com",
    ]);
  });

  it("unions env emails with hub_members.json", () => {
    const allow = effectiveAllowlist(["env@sj.com"], {
      members: [{ email: "file@sj.com" }, { email: "ENV@sj.com" }],
    });
    expect(allow).toEqual(new Set(["env@sj.com", "file@sj.com"]));
  });

  it("denies everyone when both sources are empty", () => {
    expect(isEmailAllowed("anyone@sj.com", [], null)).toBe(false);
    expect(isEmailAllowed("anyone@sj.com", [], { members: [] })).toBe(false);
  });

  it("matches the normalized email only", () => {
    expect(
      isEmailAllowed("Ada@SJ.com", [], { members: [{ email: "ada@sj.com" }] }),
    ).toBe(true);
    expect(
      isEmailAllowed("eve@sj.com", ["ada@sj.com"], {
        members: [{ email: "bob@sj.com" }],
      }),
    ).toBe(false);
  });

  it("normalizeEmail trims", () => {
    expect(normalizeEmail("  Cap@Sj.com ")).toBe("cap@sj.com");
  });
});
