/**
 * SJ Hockey only uses Forward / Defense / Goalie lineup slots, so the hub
 * shows F / D / G instead of ESPN's C / LW / RW. Client-safe.
 */

export type HockeyGroup = "F" | "D" | "G";

const GROUP: Record<string, HockeyGroup> = {
  C: "F",
  LW: "F",
  RW: "F",
  F: "F",
  CENTER: "F",
  "LEFT WING": "F",
  "RIGHT WING": "F",
  FORWARD: "F",
  D: "D",
  DEFENSE: "D",
  DEFENCE: "D",
  G: "G",
  GOALIE: "G",
};

/** "C" / "Left Wing" / "D" / "Goalie" → F / D / G (null when unknown). */
export function hockeyGroup(position: string | null | undefined): HockeyGroup | null {
  return position ? (GROUP[position.trim().toUpperCase()] ?? null) : null;
}

const BENCH_SLOTS: Record<string, string> = { BE: "Bench", BENCH: "Bench", IR: "IR", IL: "IR" };

/**
 * The roster "Position" cell: F / D / G, plus where the player sits when
 * they are not in the starting lineup ("F · Bench", "D · IR").
 */
export function hockeyPositionLabel(position: string | null | undefined, slot: string | null | undefined): string {
  const group = hockeyGroup(position) ?? hockeyGroup(slot) ?? position ?? "—";
  const away = slot ? BENCH_SLOTS[slot.trim().toUpperCase()] : undefined;
  return away ? `${group} · ${away}` : group;
}
