/**
 * Hub-native fantasy golf (roadmap Phase 6).
 * Client-safe settings helpers + snapshot builder — no tour feed, no `ffa`.
 * Disk writes live in `golf-store.ts` (server-only).
 */

import { runGolfDraft } from "@/lib/golf-draft";
import { buildLineupsPayload, GOLF_FIXTURE_NOW } from "@/lib/golf-lineup";
import {
  applyMatchupsFromScoreboard,
  applyStandingsFromScoreboard,
  buildScoreboardPayload,
} from "@/lib/golf-score";

export const GOLF_MIN_TEAMS = 6;
export const GOLF_MAX_TEAMS = 14;
export const GOLF_STARTERS = 5;
export const GOLF_MIN_BENCH = 2;
export const GOLF_MAX_BENCH = 20;
export const GOLF_DEFAULT_BENCH = 10;
export const GOLF_DEFAULT_BUDGET = 200;
export const GOLF_MIN_BUDGET = 50;
export const GOLF_MAX_BUDGET = 1000;
export const GOLF_DEFAULT_KEEPER_SLOTS = 2;
export const GOLF_MAX_KEEPER_SLOTS = 5;

export type GolfFormat = "h2h" | "season_points";
export type MissedCutMode = "off" | "alt1" | "alt1_2";
export type DraftStyle = "snake" | "auction";

export type GolfSettings = {
  draft: {
    style: DraftStyle;
    keepers: boolean;
    keeper_slots: number;
    budget: number;
  };
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
  draft: {
    style: "snake",
    keepers: false,
    keeper_slots: 0,
    budget: GOLF_DEFAULT_BUDGET,
  },
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
  keeper_slots?: number;
  budget?: number;
  /** When false, skip offline draft (live auction room fills it). */
  run_draft?: boolean;
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

export function parseGolfSettings(raw: unknown): GolfSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const golf = (raw as { golf?: unknown }).golf;
  if (!golf || typeof golf !== "object") return null;
  const merged = {
    ...DEFAULT_GOLF_SETTINGS,
    ...(golf as GolfSettings),
    draft: {
      ...DEFAULT_GOLF_SETTINGS.draft,
      ...((golf as GolfSettings).draft ?? {}),
    },
  };
  return normalizeDraftSettings(merged);
}

function normalizeDraftSettings(golf: GolfSettings): GolfSettings {
  const draft = { ...golf.draft };
  if (!draft.keepers) {
    draft.keepers = false;
    draft.keeper_slots = 0;
  } else if (draft.keeper_slots <= 0) {
    draft.keeper_slots = GOLF_DEFAULT_KEEPER_SLOTS;
  }
  if (
    draft.budget < GOLF_MIN_BUDGET ||
    draft.budget > GOLF_MAX_BUDGET ||
    !Number.isFinite(draft.budget)
  ) {
    draft.budget = GOLF_DEFAULT_BUDGET;
  }
  return { ...golf, draft };
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
  if (input.draft_style !== "snake" && input.draft_style !== "auction") {
    return "draft style must be snake or auction";
  }
  if (!["off", "alt1", "alt1_2"].includes(input.missed_cut)) {
    return "missed cut mode must be off, alt1, or alt1_2";
  }
  const budget = input.budget ?? GOLF_DEFAULT_BUDGET;
  if (budget < GOLF_MIN_BUDGET || budget > GOLF_MAX_BUDGET) {
    return `budget must be ${GOLF_MIN_BUDGET}–${GOLF_MAX_BUDGET}`;
  }
  if (input.keepers) {
    const slots = input.keeper_slots ?? GOLF_DEFAULT_KEEPER_SLOTS;
    if (slots < 1 || slots > GOLF_MAX_KEEPER_SLOTS) {
      return `keeper slots must be 1–${GOLF_MAX_KEEPER_SLOTS}`;
    }
    if (slots > GOLF_STARTERS + input.bench) {
      return "keeper slots cannot exceed roster size";
    }
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

export function buildGolfSnapshot(
  input: CreateGolfLeagueInput & { run_draft?: boolean },
) {
  const keepers = Boolean(input.keepers);
  const keeperSlots = keepers
    ? (input.keeper_slots ?? GOLF_DEFAULT_KEEPER_SLOTS)
    : 0;
  const budget = input.budget ?? GOLF_DEFAULT_BUDGET;
  const golf = normalizeDraftSettings({
    ...DEFAULT_GOLF_SETTINGS,
    draft: {
      style: input.draft_style,
      keepers,
      keeper_slots: keeperSlots,
      budget,
    },
    roster: { starters: GOLF_STARTERS, bench: input.bench },
    missed_cut: { mode: input.missed_cut },
    multipliers: { ...input.multipliers },
  });
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
    roster: [] as ReturnType<typeof runGolfDraft>["players"],
  }));
  const runDraft = input.run_draft !== false;
  const drafted = runDraft
    ? runGolfDraft(teams, golf.draft.style, {
        starters: GOLF_STARTERS,
        bench: input.bench,
        keepers: golf.draft.keepers,
        keeper_slots: golf.draft.keeper_slots,
        budget: golf.draft.budget,
      })
    : { draft: [], players: [], free_agents: [] };
  const synced_at = new Date().toISOString();
  const lineups = runDraft
    ? buildLineupsPayload(teams, input.season, golf, {
        savedAt: synced_at,
        nowIso: GOLF_FIXTURE_NOW,
      })
    : undefined;
  const scoreboard = lineups
    ? buildScoreboardPayload(teams, lineups, golf, synced_at)
    : undefined;
  if (scoreboard) {
    applyStandingsFromScoreboard(teams, scoreboard, input.format);
    applyMatchupsFromScoreboard(teams, scoreboard);
  }
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
    current_week: lineups ? 1 : (null as number | null),
    period_label: "event",
    synced_at,
    settings: {
      team_count: input.team_count,
      scoring_type: "GOLF_COUNTING",
      golf,
    },
    draft: drafted.draft,
    transactions: [] as unknown[],
    free_agents: drafted.free_agents,
    teams,
    players: drafted.players,
    ...(lineups ? { lineups } : {}),
    ...(scoreboard ? { scoreboard } : {}),
  };
}
