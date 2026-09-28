import type { Player, Team } from "@/lib/data";

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

export function injuryTone(player: Player): "ok" | "warn" | "bad" {
  const status = (player.injury_status || player.status || "").toUpperCase();
  if (
    player.injured ||
    status.includes("OUT") ||
    status === "IR" ||
    status === "IL" ||
    status.includes("INJURY_RESERVE") ||
    status.includes("INJURY RESERVE")
  ) {
    return "bad";
  }
  if (
    status.includes("DAY") ||
    status === "DTD" ||
    status.includes("QUESTION") ||
    status.includes("DOUBTFUL")
  ) {
    return "warn";
  }
  return "ok";
}

/** Title-case sport/format for the league kicker pill. */
export function sportFormatLabel(sport: string, format: string): string {
  const title = (value: string) =>
    value
      ? value
          .split("_")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ")
      : value;
  return `${title(sport)} · ${title(format)}`;
}
