"use client";

import { useSyncExternalStore } from "react";

const ACCENTS = [
  { name: "Signal Red", hex: "#ec3013" },
  { name: "Ink", hex: "#201e1d" },
  { name: "Pine", hex: "#1f4d3a" },
  { name: "Cobalt", hex: "#2b4a8b" },
] as const;

const STORAGE_KEY = "sj-accent";
const DEFAULT = ACCENTS[0].hex;
const listeners = new Set<() => void>();

function isAccent(value: string | null): value is string {
  return Boolean(value && /^#[0-9a-fA-F]{6}$/.test(value));
}

function readAccent(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isAccent(saved)) return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT;
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function applyAccent(hex: string) {
  document.documentElement.style.setProperty("--color-accent", hex);
}

export const ACCENT_INIT_SCRIPT = `try{var a=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(a&&/^#[0-9a-fA-F]{6}$/.test(a)){document.documentElement.style.setProperty("--color-accent",a)}}catch(e){}`;

export function AccentPicker() {
  const accent = useSyncExternalStore(subscribe, readAccent, () => DEFAULT);

  function choose(hex: string) {
    applyAccent(hex);
    try {
      localStorage.setItem(STORAGE_KEY, hex);
    } catch {
      /* ignore */
    }
    listeners.forEach((listener) => listener());
  }

  return (
    <div className="accent-picker" role="group" aria-label="Accent color">
      {ACCENTS.map((item) => (
        <button
          key={item.hex}
          type="button"
          className={
            item.hex === accent ? "accent-swatch is-active" : "accent-swatch"
          }
          style={{ background: item.hex }}
          title={item.name}
          aria-label={item.name}
          aria-pressed={item.hex === accent}
          onClick={() => choose(item.hex)}
        />
      ))}
    </div>
  );
}
