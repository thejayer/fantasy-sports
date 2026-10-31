import { describe, expect, it } from "vitest";

import { SIGN_OUT_BODY as DIALOG_BODY, SIGN_OUT_TITLE as DIALOG_TITLE } from "@/components/SignOutDialog";
import {
  LINK_TEAMS_PATH,
  SIGN_OUT_ALL_PATH,
  SIGN_OUT_BODY,
  SIGN_OUT_TITLE,
  accountMenuItems,
  initialsOf,
  meResponse,
  safeAvatar,
} from "./account-menu";

const config = { fantasyHubUrl: "https://hub.example", casinoEnabled: true };

describe("account menu", () => {
  it("lists Profile, Link teams, Settings in that order", () => {
    expect(accountMenuItems(config)).toEqual([
      { id: "profile", label: "Profile", href: "/profile" },
      { id: "link-teams", label: "Link teams", href: LINK_TEAMS_PATH },
      { id: "settings", label: "Settings", href: "https://hub.example/settings" },
    ]);
    expect(LINK_TEAMS_PATH).toBe("/profile#linked-teams");
  });

  it("drops Link teams while the casino is off", () => {
    expect(accountMenuItems({ ...config, casinoEnabled: false }).map((i) => i.id)).toEqual(["profile", "settings"]);
  });

  it("asks the same question everywhere", () => {
    expect(SIGN_OUT_TITLE).toBe("Sign out of all Strictly Jayers sites?");
    expect(SIGN_OUT_ALL_PATH).toBe("/api/signout-all");
    expect(DIALOG_TITLE).toBe(SIGN_OUT_TITLE);
    expect(DIALOG_BODY).toBe(SIGN_OUT_BODY);
  });

  it("answers signed-out with no user", () => {
    const out = meResponse(null, config);
    expect(out.signedIn).toBe(false);
    expect(out.user).toBeNull();
    expect(out.signIn).toBe("/login");
  });

  it("never puts an email or id in the reply", () => {
    const out = meResponse({ name: "Pat", image: null }, config);
    expect(Object.keys(out.user ?? {}).sort()).toEqual(["image", "name"]);
    expect(JSON.stringify(out)).not.toMatch(/@/);
  });

  it("only renders https avatars", () => {
    expect(safeAvatar("https://lh3.example/a.png")).toBe("https://lh3.example/a.png");
    expect(safeAvatar("http://x/a.png")).toBeNull();
    expect(safeAvatar("javascript:alert(1)")).toBeNull();
    expect(safeAvatar("data:image/png;base64,AAAA")).toBeNull();
    expect(safeAvatar(null)).toBeNull();
  });

  it("makes initials", () => {
    expect(initialsOf("Pat Jay")).toBe("PJ");
    expect(initialsOf("pat.jay")).toBe("PJ");
    expect(initialsOf("")).toBe("");
    expect(initialsOf(null)).toBe("");
  });
});
