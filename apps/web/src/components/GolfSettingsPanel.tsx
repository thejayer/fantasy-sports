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
  const draftBits = [
    golf.draft.style,
    golf.draft.keepers
      ? `${golf.draft.keeper_slots} keeper${golf.draft.keeper_slots === 1 ? "" : "s"}`
      : null,
    golf.draft.style === "auction" ? `$${golf.draft.budget} budget` : null,
  ].filter(Boolean);
  const maxStarts = golf.starts.max_per_segment;
  const rows: Array<[string, string]> = [
    ["Format", league.format === "season_points" ? "Season points" : "Head-to-head"],
    ["Teams", String(league.team_count)],
    ["Starters", String(golf.roster.starters)],
    ["Bench", String(golf.roster.bench)],
    ["Draft", draftBits.join(" · ")],
    ["Captain", golf.captain_tiebreaker ? "Tiebreaker only" : "Off"],
    ["Missed cut", modeLabel(golf.missed_cut.mode)],
    [
      "Starts / segment",
      maxStarts && maxStarts > 0
        ? `${maxStarts} (official-game style)`
        : "Unlimited",
    ],
    [
      "Missed deadline",
      golf.missed_deadline.auto_pick
        ? "Auto-pick default lineup"
        : "No auto-pick",
    ],
    [
      "Counting",
      `Thu/Fri best ${golf.scoring.thu_fri_count} of 5 · Sat/Sun all ${golf.scoring.sat_sun_count}` +
        (golf.scoring.drop_worst_golfer ? " · drop worst golfer" : ""),
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
        PGA Tour counting model. Offline snake or auction draft (optional
        keepers), weekly lineups with tee-time locks, EOD scoreboard, and
        standings — no live tour feed.
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
