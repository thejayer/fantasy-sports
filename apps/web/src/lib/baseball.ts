import type { Player, SeasonStats, Team } from "@/lib/data";

export function recordLabel(team: Pick<Team, "wins" | "losses" | "ties">): string {
  return team.ties ? `${team.wins}-${team.losses}-${team.ties}` : `${team.wins}-${team.losses}`;
}

export function winPctLabel(team: Team): string {
  if (team.win_pct == null) {
    const games = team.wins + team.losses + team.ties;
    if (!games) return "—";
    return ((team.wins + 0.5 * team.ties) / games).toFixed(3).replace(/^0/, "");
  }
  return team.win_pct.toFixed(3).replace(/^0/, "");
}

export function formatStat(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (digits === 0) return String(Math.round(value));
  if (digits === 3 && value < 1) return value.toFixed(3).replace(/^0/, "");
  return value.toFixed(digits);
}

export function stat(player: Player, key: keyof SeasonStats): number | null {
  const value = player.season_stats?.[key];
  return typeof value === "number" ? value : null;
}

export function isPitcher(player: Player): boolean {
  if (player.role === "pitcher") return true;
  if (player.role === "batter") return false;
  const pos = (player.position || "").toUpperCase();
  const slot = (player.slot || "").toUpperCase();
  return ["P", "SP", "RP"].includes(pos) || ["P", "SP", "RP"].includes(slot);
}

export function injuryTone(player: Player): "ok" | "warn" | "bad" {
  const status = (player.injury_status || player.status || "").toUpperCase();
  if (player.injured || status.includes("OUT") || status === "IR" || status === "IL") return "bad";
  if (status.includes("DAY") || status === "DTD" || status.includes("QUESTION")) return "warn";
  return "ok";
}

/** Dynasty roster display order for baseball lineup slots. */
export const BASEBALL_SLOT_ORDER = [
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "OF",
  "IF",
  "UTIL",
  "DH",
  "P",
  "SP",
  "RP",
  "BE",
  "IL",
];

export function sortRoster(roster: Player[]): Player[] {
  return [...roster].sort((a, b) => {
    const ai = BASEBALL_SLOT_ORDER.indexOf((a.slot || "").toUpperCase());
    const bi = BASEBALL_SLOT_ORDER.indexOf((b.slot || "").toUpperCase());
    const aIdx = ai === -1 ? 99 : ai;
    const bIdx = bi === -1 ? 99 : bi;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return (b.total_points || 0) - (a.total_points || 0);
  });
}
