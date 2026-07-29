/**
 * Hub-native fantasy golf (roadmap Phase 6 / 6.4a).
 * Client-safe settings helpers + snapshot builder — no tour feed, no `ffa`.
 * Disk writes live in `golf-store.ts` (server-only).
 */

export const GOLF_MIN_TEAMS = 6;
export const GOLF_MAX_TEAMS = 14;
export const GOLF_STARTERS = 5;
export const GOLF_MIN_BENCH = 2;
export const GOLF_MAX_BENCH = 20;
export const GOLF_DEFAULT_BENCH = 10;

export type GolfFormat = "h2h" | "season_points";
export type MissedCutMode = "off" | "alt1" | "alt1_2";
export type DraftStyle = "snake" | "auction";

export type GolfSettings = {
  draft: { style: DraftStyle; keepers: boolean };
  roster: { starters: number; bench: number };
  captain_tiebreaker: boolean;
  missed_cut: { mode: MissedCutMode };
  schedule: { source: "fedex_cup"; include: string[]; exclude: string[] };
  multipliers: { regular: number; signature: number; major: number };
  scoring: {
    grain: "end_of_day";
    player_points: "neg_to_par";
    thu_fri_count: number;
    sat_sun_count: number;
  };
};

export const DEFAULT_GOLF_SETTINGS: GolfSettings = {
  draft: { style: "snake", keepers: false },
  roster: { starters: GOLF_STARTERS, bench: GOLF_DEFAULT_BENCH },
  captain_tiebreaker: true,
  missed_cut: { mode: "alt1" },
  schedule: { source: "fedex_cup", include: [], exclude: [] },
  multipliers: { regular: 1.0, signature: 1.5, major: 2.0 },
  scoring: {
    grain: "end_of_day",
    player_points: "neg_to_par",
    thu_fri_count: 4,
    sat_sun_count: 5,
  },
};

export type CreateGolfLeagueInput = {
  league_id: string;
  name: string;
  short_name?: string;
  season: number;
  format: GolfFormat;
  team_count: number;
  bench: number;
  missed_cut: MissedCutMode;
  draft_style: DraftStyle;
  keepers: boolean;
  multipliers: { regular: number; signature: number; major: number };
};

const TEAM_NAMES = [
  "Fairway Phantoms",
  "Pin High Posse",
  "Sand Trap Syndicate",
  "Birdie Brigade",
  "Eagle Eyes",
  "Rough Riders",
  "Ace Alliance",
  "Bogey Bandits",
  "Cut Line Crew",
  "Green Jacket Gang",
  "Tee Box Titans",
  "Mulligan Mob",
  "Par Seekers",
  "Trophy Club",
];

export function parseGolfSettings(
  raw: unknown,
): GolfSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const golf = (raw as { golf?: unknown }).golf;
  if (!golf || typeof golf !== "object") return null;
  // Trust snapshot shape from sg / create API; display is fail-soft.
  return { ...DEFAULT_GOLF_SETTINGS, ...(golf as GolfSettings) };
}

export function validateCreateGolfLeague(
  input: CreateGolfLeagueInput,
): string | null {
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(input.league_id)) {
    return "league id must be a lowercase slug (letters, digits, hyphens)";
  }
  if (!input.name.trim()) return "name is required";
  if (
    input.team_count < GOLF_MIN_TEAMS ||
    input.team_count > GOLF_MAX_TEAMS
  ) {
    return `team count must be ${GOLF_MIN_TEAMS}–${GOLF_MAX_TEAMS}`;
  }
  if (input.bench < GOLF_MIN_BENCH || input.bench > GOLF_MAX_BENCH) {
    return `bench must be ${GOLF_MIN_BENCH}–${GOLF_MAX_BENCH}`;
  }
  if (input.format !== "h2h" && input.format !== "season_points") {
    return "format must be h2h or season_points";
  }
  if (!["off", "alt1", "alt1_2"].includes(input.missed_cut)) {
    return "missed cut mode must be off, alt1, or alt1_2";
  }
  for (const key of ["regular", "signature", "major"] as const) {
    if (!(input.multipliers[key] > 0)) {
      return `${key} multiplier must be > 0`;
    }
  }
  if (!Number.isInteger(input.season) || input.season < 2000) {
    return "season must be a valid year";
  }
  return null;
}

function teamNames(count: number): string[] {
  if (count <= TEAM_NAMES.length) return TEAM_NAMES.slice(0, count);
  return Array.from({ length: count }, (_, i) =>
    i < TEAM_NAMES.length
      ? TEAM_NAMES[i]
      : `${TEAM_NAMES[i % TEAM_NAMES.length]} ${Math.floor(i / TEAM_NAMES.length) + 1}`,
  );
}

export function buildGolfSnapshot(input: CreateGolfLeagueInput) {
  const golf: GolfSettings = {
    ...DEFAULT_GOLF_SETTINGS,
    draft: { style: input.draft_style, keepers: input.keepers },
    roster: { starters: GOLF_STARTERS, bench: input.bench },
    missed_cut: { mode: input.missed_cut },
    multipliers: { ...input.multipliers },
  };
  const names = teamNames(input.team_count);
  const teams = names.map((name, index) => ({
    team_id: index + 1,
    name,
    abbrev: name
      .split(/\s+/)
      .map((w) => w[0] ?? "")
      .join("")
      .slice(0, 4)
      .toUpperCase(),
    owners: [`Owner ${index + 1}`],
    logo_url: null,
    wins: 0,
    losses: 0,
    ties: 0,
    win_pct: 0,
    points_for: 0,
    points_against: 0,
    standing: index + 1,
    division: "",
    schedule: [] as number[],
    scores: [] as Array<number | null>,
    outcomes: [] as string[],
    roster: [] as unknown[],
  }));
  const synced_at = new Date().toISOString();
  return {
    schema_version: 2,
    league_id: input.league_id,
    espn_league_id: null as number | null,
    sport: "golf" as const,
    format: input.format,
    season: input.season,
    name: input.name.trim(),
    short_name: (input.short_name || input.name).trim(),
    scoring_type: "GOLF_COUNTING",
    team_count: input.team_count,
    current_week: null as number | null,
    period_label: "event",
    synced_at,
    settings: {
      team_count: input.team_count,
      scoring_type: "GOLF_COUNTING",
      golf,
    },
    draft: [] as unknown[],
    transactions: [] as unknown[],
    free_agents: [] as unknown[],
    teams,
    players: [] as unknown[],
  };
}
