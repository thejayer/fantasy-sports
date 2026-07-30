// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  ThemeToggle,
  nextTheme,
} from "@/components/ThemeToggle";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
});

describe("nextTheme (roadmap 7.10)", () => {
  it("cycles auto → dark → light → auto", () => {
    expect(nextTheme("system")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("system");
  });
});

describe("THEME_INIT_SCRIPT", () => {
  it("applies a stored override before paint", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    // eslint-disable-next-line no-eval -- exercises the exact string we inline
    eval(THEME_INIT_SCRIPT);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("ignores a junk value rather than setting an invalid theme", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "neon");
    // eslint-disable-next-line no-eval -- exercises the exact string we inline
    eval(THEME_INIT_SCRIPT);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("does nothing when nothing is stored, leaving the OS preference in charge", () => {
    // eslint-disable-next-line no-eval -- exercises the exact string we inline
    eval(THEME_INIT_SCRIPT);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

describe("ThemeToggle", () => {
  it("starts on Auto and pins the palette on click", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("Auto");

    await user.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(button).toHaveTextContent("Dark");

    await user.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(button).toHaveTextContent("Light");

    await user.click(button);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(button).toHaveTextContent("Auto");
  });

  it("reads the attribute the init script already set", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveTextContent("Dark");
  });

  it("names both the current and the next theme for screen readers", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveAccessibleName(
      /Colour theme: Auto\. Switch to Dark\./,
    );
  });
});
