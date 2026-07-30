/**
 * Readable rows from the synced ESPN `settings.json` (roadmap 7.9).
 *
 * The concern has been synced since 2.4 and only golf rendered it, so football
 * and baseball members could not see roster slots, scoring, FAAB, keepers, or
 * the trade deadline anywhere in the hub. AUDIT-COMPETITIVE #8.
 *
 * Pure formatting — the hub is read-only against ESPN, so nothing here writes.
 */

import type { LeagueSettings, LeagueSnapshot } from "@/lib/data";

export type SettingsRow = { label: string; value: string };
export type SettingsGroup = { title: string; rows: SettingsRow[] };

/** ESPN slot codes in the order managers expect to read them. */
const SLOT_ORDER = [
  "QB",
  "RB",
  "WR",
  "TE",
  "FLEX",
  "OP",
  "D/ST",
  "K",
  "DP",
  "BE",
  "IR",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "2B/SS",
  "1B/3B",
  "OF",
  "UTIL",
  "DH",
  "SP",
  "RP",
  "P",
  "NA",
];

function slotRank(slot: string): number {
  const index = SLOT_ORDER.indexOf(slot.toUpperCase());
  return index === -1 ? SLOT_ORDER.length : index;
}

/** `{QB: 1, RB: 2, BE: 7}` → `QB 1 · RB 2 · BE 7`, dropping empty slots. */
export function formatRosterSlots(
  counts: Record<string, number | null> | undefined,
): string | null {
  if (!counts) return null;
  const entries = Object.entries(counts)
    .filter(([, count]) => count != null && count > 0)
    .sort(([a], [b]) => slotRank(a) - slotRank(b) || a.localeCompare(b));
  if (!entries.length) return null;
  return entries.map(([slot, count]) => `${slot} ${count}`).join(" · ");
}

export function totalRosterSize(
  counts: Record<string, number | null> | undefined,
): number | null {
  if (!counts) return null;
  let total = 0;
  let seen = false;
  for (const count of Object.values(counts)) {
    if (count == null) continue;
    seen = true;
    total += count;
  }
  return seen ? total : null;
}

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

/** Keeper/dynasty behaviour derived from ESPN, not the registry declaration. */
export type KeeperFacts = {
  /** Keeper count ESPN reports, when it reports one. */
  keeperCount: number | null;
  /** True when ESPN settings actually enable keepers. */
  espnKeepers: boolean;
  /** What `configs/leagues.yaml` declares. */
  declaredDynasty: boolean;
  /** Registry says dynasty but ESPN reports no keepers. */
  mismatch: boolean;
};

export function keeperFacts(league: LeagueSnapshot): KeeperFacts {
  const keeperCount = league.settings?.keeper_count ?? null;
  const espnKeepers = keeperCount != null && keeperCount > 0;
  const declaredDynasty = league.format === "dynasty";
  return {
    keeperCount,
    espnKeepers,
    declaredDynasty,
    mismatch: declaredDynasty && keeperCount != null && !espnKeepers,
  };
}

/**
 * Whether `settings.json` actually arrived for this season.
 *
 * The "League" group below is derived from the snapshot manifest, so it renders
 * even for seasons synced before the 2.4 settings slice. Without this check the
 * settings tab would look populated while carrying nothing ESPN reported.
 */
export function hasEspnSettings(league: LeagueSnapshot): boolean {
  const settings = league.settings;
  if (!settings) return false;
  return Object.entries(settings).some(([key, value]) => {
    if (key === "golf") return false;
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  });
}

function scoringRows(settings: LeagueSettings): SettingsRow[] {
  const rows = (settings.scoring_format ?? [])
    .filter((row) => row.points != null && row.points !== 0)
    .map((row) => ({
      label: row.abbr || row.label || String(row.id ?? "?"),
      value: String(row.points),
    }));
  return rows;
}

/**
 * Grouped settings for the league settings tab. Groups with no readable rows are
 * dropped rather than rendered as a wall of dashes.
 */
export function settingsGroups(league: LeagueSnapshot): SettingsGroup[] {
  const settings = league.settings ?? {};
  const period = league.period_label || "week";
  const keepers = keeperFacts(league);

  const push = (
    rows: SettingsRow[],
    label: string,
    value: string | number | null | undefined,
  ) => {
    if (value == null || value === "") return;
    rows.push({ label, value: String(value) });
  };

  const basics: SettingsRow[] = [];
  push(basics, "Sport", titleCase(league.sport));
  push(basics, "Format", titleCase(league.format));
  push(basics, "Teams", settings.team_count ?? league.team_count);
  push(
    basics,
    "Scoring type",
    settings.scoring_type ? titleCase(settings.scoring_type) : league.scoring_type,
  );
  push(
    basics,
    `Regular season`,
    settings.reg_season_count != null
      ? `${settings.reg_season_count} ${period}s`
      : null,
  );
  push(basics, "Median scoring", settings.median_scoring ? "On" : null);
  push(
    basics,
    "Divisions",
    settings.division_map && Object.keys(settings.division_map).length
      ? Object.values(settings.division_map).join(", ")
      : null,
  );

  const roster: SettingsRow[] = [];
  push(roster, "Slots", formatRosterSlots(settings.position_slot_counts));
  push(roster, "Roster size", totalRosterSize(settings.position_slot_counts));

  const playoffs: SettingsRow[] = [];
  push(playoffs, "Playoff teams", settings.playoff_team_count);
  push(
    playoffs,
    "Round length",
    settings.playoff_matchup_period_length != null
      ? `${settings.playoff_matchup_period_length} ${period}${settings.playoff_matchup_period_length === 1 ? "" : "s"}`
      : null,
  );
  push(
    playoffs,
    "Seed tiebreak",
    settings.playoff_seed_tie_rule ? titleCase(settings.playoff_seed_tie_rule) : null,
  );
  push(
    playoffs,
    "Playoff tie rule",
    settings.playoff_tie_rule ? titleCase(settings.playoff_tie_rule) : null,
  );
  push(playoffs, "Tie rule", settings.tie_rule ? titleCase(settings.tie_rule) : null);

  const transactions: SettingsRow[] = [];
  push(transactions, "Waivers", settings.faab ? "FAAB bidding" : null);
  push(transactions, "Acquisition budget", settings.acquisition_budget);
  push(
    transactions,
    "Trade deadline",
    settings.trade_deadline != null
      ? formatTradeDeadline(settings.trade_deadline)
      : null,
  );
  push(transactions, "Veto votes required", settings.veto_votes_required);
  push(
    transactions,
    "Keepers",
    keepers.keeperCount != null
      ? keepers.espnKeepers
        ? `${keepers.keeperCount} per team`
        : "None (ESPN reports 0)"
      : null,
  );

  const scoring = scoringRows(settings);

  return [
    { title: "League", rows: basics },
    { title: "Roster", rows: roster },
    { title: "Playoffs", rows: playoffs },
    { title: "Transactions", rows: transactions },
    { title: "Scoring", rows: scoring },
  ].filter((group) => group.rows.length > 0);
}

/**
 * ESPN reports the trade deadline as an epoch-ms timestamp. Older snapshots
 * carry a week number, so anything small stays a period label.
 */
export function formatTradeDeadline(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value < 1e6) return `week ${value}`;
  const date = new Date(value > 1e12 ? value : value * 1000);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
