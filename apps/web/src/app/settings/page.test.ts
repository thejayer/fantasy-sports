import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("profile settings route (appearance home)", () => {
  const layout = readFileSync(
    path.join(process.cwd(), "src/app/layout.tsx"),
    "utf8",
  );
  const settings = readFileSync(
    path.join(process.cwd(), "src/app/settings/page.tsx"),
    "utf8",
  );

  it("header name links to /settings and no longer hosts appearance pickers", () => {
    expect(layout).toMatch(/href="\/settings"/);
    expect(layout).toMatch(/className="nav-user"/);
    expect(layout).not.toMatch(/<AccentPicker/);
    expect(layout).not.toMatch(/<ThemeToggle/);
    expect(layout).toMatch(/THEME_INIT_SCRIPT/);
    expect(layout).toMatch(/ACCENT_INIT_SCRIPT/);
  });

  it("settings page hosts AppearanceSettings and username form", () => {
    expect(settings).toMatch(/AppearanceSettings/);
    expect(settings).toMatch(/ProfileUsernameForm/);
    expect(settings).toMatch(/MemberAvatar/);
    expect(settings).toMatch(/title: "Profile"/);
  });

  it("header profile link includes MemberAvatar", () => {
    expect(layout).toMatch(/MemberAvatar/);
  });
});
