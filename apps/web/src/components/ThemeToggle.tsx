"use client";

import { useSyncExternalStore } from "react";

/**
 * Light/dark override (roadmap 7.10).
 *
 * The palette already follows `prefers-color-scheme`; this lets a member
 * override it. The chosen theme lives on `<html data-theme>`, which the CSS
 * tokens key off, and is persisted in localStorage.
 *
 * The attribute — not React state — is the source of truth, applied by
 * {@link THEME_INIT_SCRIPT} before first paint so an override never flashes the
 * wrong palette. This component reads it through `useSyncExternalStore`, which
 * is the supported way to render browser state without assigning state from an
 * effect.
 *
 * The cycle button remains for tests/reuse; the profile page uses the same
 * {@link setTheme} helpers via AppearanceSettings.
 */

export type Theme = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "sj-theme";

/**
 * Runs before paint in the document head. Kept as a string because it must
 * execute synchronously, ahead of hydration, to avoid a flash of the OS palette
 * when a member has overridden it.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}`;

const listeners = new Set<() => void>();

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readTheme(): Theme {
  const value = document.documentElement.getAttribute("data-theme");
  return value === "light" || value === "dark" ? value : "system";
}

/** Server render and hydration both start from the un-overridden palette. */
export function readThemeServer(): Theme {
  return "system";
}

export function setTheme(next: Theme): void {
  const root = document.documentElement;
  if (next === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", next);
  try {
    if (next === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Private-mode storage failures must not break the page.
  }
  for (const listener of listeners) listener();
}

const LABEL: Record<Theme, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};

const GLYPH: Record<Theme, string> = {
  system: "◑",
  light: "○",
  dark: "◐",
};

export function nextTheme(current: Theme): Theme {
  if (current === "system") return "dark";
  if (current === "dark") return "light";
  return "system";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    readTheme,
    readThemeServer,
  );
  const next = nextTheme(theme);

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Colour theme: ${LABEL[theme]}. Switch to ${LABEL[next]}.`}
      title={`Theme: ${LABEL[theme]}`}
      onClick={() => setTheme(next)}
    >
      <span aria-hidden>{GLYPH[theme]}</span>
      <span className="theme-toggle-label">{LABEL[theme]}</span>
    </button>
  );
}
