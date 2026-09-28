"use client";

import { useSyncExternalStore } from "react";

import { AccentPicker } from "@/components/AccentPicker";
import {
  readTheme,
  readThemeServer,
  setTheme,
  subscribeTheme,
  type Theme,
} from "@/components/ThemeToggle";

const THEME_OPTIONS: Array<{ id: Theme; label: string; hint: string }> = [
  { id: "system", label: "Auto", hint: "Match the device" },
  { id: "light", label: "Light", hint: "Always light" },
  { id: "dark", label: "Dark", hint: "Always dark" },
];

/**
 * Profile appearance controls — accent + light/dark (roadmap 7.10).
 * Prefs stay in localStorage; this page is just the home for the pickers.
 */
export function AppearanceSettings() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    readTheme,
    readThemeServer,
  );

  return (
    <div className="appearance-settings">
      <div className="appearance-block">
        <h3 className="roster-group-title">Accent</h3>
        <p className="league-meta">
          Signal colour for pills, links, and highlights on this device.
        </p>
        <AccentPicker layout="labeled" />
      </div>

      <div className="appearance-block">
        <h3 className="roster-group-title">Colour theme</h3>
        <p className="league-meta">
          Auto follows your device. Light and Dark pin the palette.
        </p>
        <div className="theme-chooser" role="radiogroup" aria-label="Colour theme">
          {THEME_OPTIONS.map((option) => {
            const active = theme === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={
                  active ? "theme-choice is-active" : "theme-choice"
                }
                onClick={() => setTheme(option.id)}
              >
                <span className="theme-choice-label">{option.label}</span>
                <span className="theme-choice-hint">{option.hint}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
