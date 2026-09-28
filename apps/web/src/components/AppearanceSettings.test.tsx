// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { AppearanceSettings } from "@/components/AppearanceSettings";
import { THEME_STORAGE_KEY } from "@/components/ThemeToggle";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("--color-accent");
  window.localStorage.clear();
});

describe("AppearanceSettings", () => {
  it("pins light/dark from the profile chooser", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);

    await user.click(screen.getByRole("radio", { name: /Dark/i }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    await user.click(screen.getByRole("radio", { name: /Light/i }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    await user.click(screen.getByRole("radio", { name: /Auto/i }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("offers labeled accent choices", async () => {
    const user = userEvent.setup();
    render(<AppearanceSettings />);
    await user.click(screen.getByRole("button", { name: "Pine" }));
    expect(
      document.documentElement.style.getPropertyValue("--color-accent"),
    ).toBe("#1f4d3a");
  });
});
