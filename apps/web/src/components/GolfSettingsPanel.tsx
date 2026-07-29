import type { GolfSettings } from "@/lib/golf";
import { DEFAULT_GOLF_SETTINGS, parseGolfSettings } from "@/lib/golf";
import type { LeagueSnapshot } from "@/lib/data";

function modeLabel(mode: string): string {
  if (mode === "alt1_2") return "Alt1 + Alt2 (weekend)";
  if (mode === "alt1") return "Alt1 (weekend)";
  if (mode === "off") return "Off (MC contributes nothing)";
  return mode;
}

export function GolfSettingsPanel({ league }: { league: LeagueSnapshot }) {
  const golf: GolfSettings =
    parseGolfSettings(league.settings) ?? DEFAULT_GOLF_SETTINGS;
  const rows: Array<[string, string]> = [
    ["Format", league.format === "season_points" ? "Season points" : "Head-to-head"],
    ["Teams", String(league.team_count)],
    ["Starters", String(golf.roster.starters)],
    ["Bench", String(golf.roster.bench)],
    ["Draft", `${golf.draft.style}${golf.draft.keepers ? " · keepers" : ""}`],
    ["Captain", golf.captain_tiebreaker ? "Tiebreaker only" : "Off"],
    ["Missed cut", modeLabel(golf.missed_cut.mode)],
    [
      "Counting",
      `Thu/Fri best ${golf.scoring.thu_fri_count} of 5 · Sat/Sun all ${golf.scoring.sat_sun_count}`,
    ],
    ["Player points", "−(to-par)"],
    ["Scoring cadence", golf.scoring.grain.replaceAll("_", " ")],
    [
      "Event multipliers",
      `regular ${golf.multipliers.regular}× · signature ${golf.multipliers.signature}× · major ${golf.multipliers.major}×`,
    ],
    ["Schedule", golf.schedule.source.replaceAll("_", " ")],
  ];

  return (
    <div className="panel">
      <h3>League settings</h3>
      <p className="lede" style={{ marginTop: 0 }}>
        PGA Tour counting model (roadmap 6.1). Snake draft + OWGR pool are in
        (6.4b); weekly lineups and end-of-day scoring come next — no live tour
        feed.
      </p>
      <dl className="settings-grid">
        {rows.map(([label, value]) => (
          <div key={label} className="settings-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
