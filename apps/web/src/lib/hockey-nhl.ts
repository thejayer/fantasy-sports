/**
 * Hockey NHL data layer join (HOCKEY-PORT.md H1).
 *
 * `sj sync` / `sj nhl` write `{league}/{season}/nhl/player_map.json` (ESPN id →
 * NHL id) and `nhl_context.json` (age, ht/wt, team, TOI) from the public NHL
 * API. The hub only reads those sidecars — it never calls the NHL. Missing
 * values stay null and render as "—", never 0. Client-safe (no fs).
 */

export type HockeyPlayerMapEntry = {
  nhl_id: number;
  espn_name?: string | null;
  nhl_name?: string | null;
  group?: string | null;
  espn_team?: string | null;
  nhl_team?: string | null;
  method: "name" | "initial_last" | "search" | string;
  rostered: boolean;
};

export type HockeyCoverage = {
  total: number;
  matched: number;
  rate: number | null;
};

export type HockeyPlayerMapSnapshot = {
  schema_version: number;
  league_id: string;
  season: number;
  sport: "hockey";
  nhl_season: string;
  generated_at: string;
  coverage: {
    rostered: HockeyCoverage;
    free_agents: HockeyCoverage;
    all: HockeyCoverage;
    by_method: Record<string, number>;
  };
  players: Record<string, HockeyPlayerMapEntry>;
  unmatched: {
    espn_id: number | null;
    name: string | null;
    position: string | null;
    pro_team: string | null;
    rostered: boolean;
  }[];
  errors: string[];
};

export type HockeyToi = {
  basis: string | null;
  gp: number | null;
  toi_min: number | null;
  ev_min: number | null;
  pp_min: number | null;
  sh_min: number | null;
};

export type HockeyNhlPlayer = {
  nhl_id: number;
  name: string;
  position: string | null;
  group: "F" | "D" | "G" | string;
  team: string | null;
  prior_team: string | null;
  birth_date: string | null;
  age: number | null;
  height_in: number | null;
  weight_lb: number | null;
  on_nhl_roster: boolean;
  toi: HockeyToi | null;
  goalie?: {
    basis: string | null;
    gs: number | null;
    start_share: number | null;
    role: string | null;
  };
};

export type HockeyNhlContextSnapshot = {
  schema_version: number;
  league_id: string;
  season: number;
  sport: "hockey";
  nhl_season: string;
  generated_at: string;
  as_of: string;
  players: Record<string, HockeyNhlPlayer>;
  errors: string[];
};

export type HockeyNhlSnapshot = {
  playerMap: HockeyPlayerMapSnapshot | null;
  context: HockeyNhlContextSnapshot | null;
};

/** One row's NHL columns: Age, Ht, Wt, Team, EV min, PP min. */
export type HockeyBio = {
  nhlId: number;
  age: number | null;
  heightIn: number | null;
  weightLb: number | null;
  team: string | null;
  priorTeam: string | null;
  evMin: number | null;
  ppMin: number | null;
  /** Which TOI sample the minutes came from ("this season", "last season", …). */
  toiBasis: string | null;
};

export type HockeyBioIndex = Record<string, HockeyBio>;

/**
 * ESPN player id → NHL bio for the given ids (or every mapped player).
 * Unmapped players are simply absent — callers render "—".
 */
export function hockeyBioIndex(
  snapshot: HockeyNhlSnapshot | null | undefined,
  espnIds?: Iterable<number | string | null | undefined>,
): HockeyBioIndex {
  const map = snapshot?.playerMap?.players;
  const context = snapshot?.context?.players;
  if (!map || !context) return {};
  const wanted = espnIds
    ? [...espnIds].filter((id) => id != null).map((id) => String(id))
    : Object.keys(map);
  const out: HockeyBioIndex = {};
  for (const espnId of wanted) {
    const entry = map[espnId];
    if (!entry) continue;
    const nhl = context[String(entry.nhl_id)];
    if (!nhl) continue;
    out[espnId] = {
      nhlId: nhl.nhl_id,
      age: nhl.age ?? null,
      heightIn: nhl.height_in ?? null,
      weightLb: nhl.weight_lb ?? null,
      team: nhl.team ?? null,
      priorTeam: nhl.prior_team ?? null,
      evMin: nhl.toi?.ev_min ?? null,
      ppMin: nhl.toi?.pp_min ?? null,
      toiBasis: nhl.toi?.basis ?? null,
    };
  }
  return out;
}

/** 74 → `6'2"`. */
export function formatHeight(inches: number | null | undefined): string {
  if (inches == null || !Number.isFinite(inches) || inches <= 0) return "—";
  const feet = Math.floor(inches / 12);
  return `${feet}'${Math.round(inches - feet * 12)}"`;
}

/** Per-game minutes with one decimal; null → "—" (never 0). */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  return minutes.toFixed(1);
}

export function formatWhole(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Math.round(value));
}

/** Team cell text plus a tooltip naming last season's club when he moved. */
export function teamLabel(bio: HockeyBio | undefined): {
  text: string;
  title?: string;
} {
  if (!bio?.team) return { text: "—" };
  return bio.priorTeam
    ? { text: bio.team, title: `Last season: ${bio.priorTeam}` }
    : { text: bio.team };
}

/** Tooltip for EV/PP minutes so a last-season sample is never mistaken for current. */
export function toiTitle(bio: HockeyBio | undefined): string | undefined {
  if (!bio?.toiBasis) return undefined;
  return `Per-game ice time, ${bio.toiBasis}`;
}
