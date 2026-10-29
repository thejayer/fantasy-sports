import { describe, expect, it } from "vitest";

import { isSideNavActive, type SideNavItem } from "./SideNav";

describe("isSideNavActive", () => {
  it("marks in-app routes active", () => {
    expect(
      isSideNavActive("/ai", { label: "AI News", href: "/ai" }),
    ).toBe(true);
    expect(
      isSideNavActive("/watch/clip", { label: "Watch", href: "/watch" }),
    ).toBe(true);
    expect(isSideNavActive("/ai", { label: "Home", href: "/" })).toBe(false);
  });

  it("never marks external or hard-anchor items active", () => {
    const casino: SideNavItem = {
      label: "Casino",
      href: "/casino",
      anchor: true,
    };
    expect(isSideNavActive("/casino", casino)).toBe(false);
    expect(
      isSideNavActive("/ai", {
        label: "Fantasy",
        href: "https://fantasy.strictlyjayers.com",
        external: true,
      }),
    ).toBe(false);
  });
});
