/**
 * Offline OWGR pool + snake/auction drafts for hub create.
 * Mirrors `src/sg/pool.py` + `src/sg/draft.py`.
 */

/** Keep in sync with `GOLF_STARTERS` in `golf.ts` / `sg.settings.STARTERS`. */
const STARTERS = 5;

export type OwgrPlayer = {
  id: number;
  name: string;
  owgr_rank: number;
  country: string | null;
};

const NAMED_POOL: Array<[string, string | null]> = [
  ["Scottie Scheffler", "USA"],
  ["Rory McIlroy", "NIR"],
  ["Xander Schauffele", "USA"],
  ["Collin Morikawa", "USA"],
  ["Ludvig Aberg", "SWE"],
  ["Jon Rahm", "ESP"],
  ["Wyndham Clark", "USA"],
  ["Viktor Hovland", "NOR"],
  ["Patrick Cantlay", "USA"],
  ["Tommy Fleetwood", "ENG"],
  ["Hideki Matsuyama", "JPN"],
  ["Justin Thomas", "USA"],
  ["Sahith Theegala", "USA"],
  ["Max Homa", "USA"],
  ["Brian Harman", "USA"],
  ["Matt Fitzpatrick", "ENG"],
  ["Tony Finau", "USA"],
  ["Sam Burns", "USA"],
  ["Jordan Spieth", "USA"],
  ["Shane Lowry", "IRL"],
  ["Russell Henley", "USA"],
  ["Sungjae Im", "KOR"],
  ["Jason Day", "AUS"],
  ["Tom Kim", "KOR"],
  ["Sepp Straka", "AUT"],
  ["Chris Kirk", "USA"],
  ["Byeong Hun An", "KOR"],
  ["Cameron Young", "USA"],
  ["Keegan Bradley", "USA"],
  ["Adam Scott", "AUS"],
  ["Billy Horschel", "USA"],
  ["Corey Conners", "CAN"],
  ["Si Woo Kim", "KOR"],
  ["Harris English", "USA"],
  ["Aaron Rai", "ENG"],
  ["Akira Aoyama", "JPN"],
  ["Denny McCarthy", "USA"],
  ["Eric Cole", "USA"],
  ["Stephan Jaeger", "GER"],
  ["Alex Noren", "SWE"],
  ["Min Woo Lee", "AUS"],
  ["Nick Taylor", "CAN"],
  ["Will Zalatoris", "USA"],
  ["Davis Thompson", "USA"],
  ["J.T. Poston", "USA"],
  ["Adam Hadwin", "CAN"],
  ["Taylor Pendrith", "CAN"],
  ["Austin Eckroat", "USA"],
  ["Jake Knapp", "USA"],
  ["Nicolai Hojgaard", "DEN"],
];

export type GolfDraftPick = {
  round: number;
  round_pick: number;
  team_id: number;
  player_id: number;
  player_name: string;
  bid_amount: number;
  keeper: boolean;
  nominating_team_id: number | null;
};

export type GolfPlayerRow = {
  id: number;
  name: string;
  position: string;
  slot: string;
  pro_team: string | null;
  injury_status: null;
  status: string;
  injured: boolean;
  eligible_slots: string[];
  acquisition_type: string;
  percent_owned: null;
  total_points: number;
  projected_total_points: null;
  avg_points: null;
  season_stats: { OWGR: number };
  role: string;
  fantasy_team?: string;
};

export function owgrPool(size: number): OwgrPlayer[] {
  if (size < 1) throw new Error("OWGR pool size must be >= 1");
  return Array.from({ length: size }, (_, i) => {
    const rank = i + 1;
    const named = NAMED_POOL[i];
    return {
      id: rank,
      name: named ? named[0] : `OWGR Golfer ${rank}`,
      owgr_rank: rank,
      country: named ? named[1] : null,
    };
  });
}

export function poolSizeForLeague(
  teamCount: number,
  starters: number,
  bench: number,
): number {
  const needed = teamCount * (starters + bench);
  return Math.max(needed + 20, needed + teamCount);
}

export function keeperCost(budget: number, rosterSlots: number): number {
  if (rosterSlots < 1) return 1;
  return Math.max(1, Math.min(20, Math.floor(budget / (rosterSlots * 2))));
}

function playerRow(golfer: OwgrPlayer, slot: string): GolfPlayerRow {
  return {
    id: golfer.id,
    name: golfer.name,
    position: "G",
    slot,
    pro_team: golfer.country,
    injury_status: null,
    status: "ACTIVE",
    injured: false,
    eligible_slots: ["GS", "BE", "ALT"],
    acquisition_type: slot === "FA" ? "FREEAGENT" : "DRAFT",
    percent_owned: null,
    total_points: 0,
    projected_total_points: null,
    avg_points: null,
    season_stats: { OWGR: golfer.owgr_rank },
    role: "golfer",
  };
}

export type DraftTeam = {
  team_id: number;
  name: string;
  roster: GolfPlayerRow[];
};

export type DraftOptions = {
  starters?: number;
  bench: number;
  keepers?: boolean;
  keeper_slots?: number;
  budget?: number;
};

function uniquePlayers(teams: DraftTeam[]): GolfPlayerRow[] {
  const seen = new Map<number, GolfPlayerRow>();
  for (const team of teams) {
    for (const player of team.roster) {
      if (!seen.has(player.id)) {
        seen.set(player.id, { ...player, fantasy_team: team.name });
      }
    }
  }
  return [...seen.values()].sort(
    (a, b) => a.season_stats.OWGR - b.season_stats.OWGR,
  );
}

export function runSnakeDraft(
  teams: DraftTeam[],
  options: DraftOptions,
): {
  draft: GolfDraftPick[];
  players: GolfPlayerRow[];
  free_agents: GolfPlayerRow[];
} {
  const starters = options.starters ?? STARTERS;
  const { bench } = options;
  if (teams.length < 2) throw new Error("snake draft needs at least 2 teams");
  const rounds = starters + bench;
  const keeperSlots =
    options.keepers && (options.keeper_slots ?? 0) > 0
      ? (options.keeper_slots ?? 0)
      : 0;
  if (keeperSlots > rounds) {
    throw new Error("keeper_slots cannot exceed roster size");
  }
  const size = poolSizeForLeague(teams.length, starters, bench);
  const board = owgrPool(size);
  const byId = new Map(teams.map((t) => [t.team_id, t]));
  for (const team of teams) team.roster = [];

  const order = teams.map((t) => t.team_id);
  const draft: GolfDraftPick[] = [];
  let cursor = 0;
  for (let rnd = 1; rnd <= rounds; rnd += 1) {
    const roundOrder = rnd % 2 === 1 ? order : [...order].reverse();
    roundOrder.forEach((teamId, index) => {
      const golfer = board[cursor];
      cursor += 1;
      const team = byId.get(teamId);
      if (!team || !golfer) throw new Error("draft exhausted pool");
      const slot = team.roster.length < starters ? "GS" : "BE";
      team.roster.push(playerRow(golfer, slot));
      draft.push({
        round: rnd,
        round_pick: index + 1,
        team_id: teamId,
        player_id: golfer.id,
        player_name: golfer.name,
        bid_amount: 0,
        keeper: rnd <= keeperSlots,
        nominating_team_id: null,
      });
    });
  }

  return {
    draft,
    players: uniquePlayers(teams),
    free_agents: board.slice(cursor).map((g) => playerRow(g, "FA")),
  };
}

export function runAuctionDraft(
  teams: DraftTeam[],
  options: DraftOptions,
): {
  draft: GolfDraftPick[];
  players: GolfPlayerRow[];
  free_agents: GolfPlayerRow[];
} {
  const starters = options.starters ?? STARTERS;
  const { bench } = options;
  if (teams.length < 2) throw new Error("auction draft needs at least 2 teams");
  const rosterSlots = starters + bench;
  const keeperSlots =
    options.keepers && (options.keeper_slots ?? 0) > 0
      ? (options.keeper_slots ?? 0)
      : 0;
  if (keeperSlots > rosterSlots) {
    throw new Error("keeper_slots cannot exceed roster size");
  }
  const budget = options.budget ?? 200;
  const cost = keeperCost(budget, rosterSlots);
  const size = poolSizeForLeague(teams.length, starters, bench);
  const board = owgrPool(size);
  const byId = new Map(teams.map((t) => [t.team_id, t]));
  const teamIds = teams.map((t) => t.team_id);
  const budgets = new Map(teamIds.map((id) => [id, budget] as const));
  for (const team of teams) team.roster = [];

  const draft: GolfDraftPick[] = [];
  let cursor = 0;

  if (keeperSlots > 0) {
    for (let rnd = 1; rnd <= keeperSlots; rnd += 1) {
      const roundOrder = rnd % 2 === 1 ? teamIds : [...teamIds].reverse();
      roundOrder.forEach((teamId, index) => {
        const left = budgets.get(teamId) ?? 0;
        if (left < cost) {
          throw new Error(`team ${teamId} cannot afford keeper cost ${cost}`);
        }
        const golfer = board[cursor];
        cursor += 1;
        const team = byId.get(teamId);
        if (!team || !golfer) throw new Error("draft exhausted pool");
        const slot = team.roster.length < starters ? "GS" : "BE";
        team.roster.push(playerRow(golfer, slot));
        budgets.set(teamId, left - cost);
        draft.push({
          round: rnd,
          round_pick: index + 1,
          team_id: teamId,
          player_id: golfer.id,
          player_name: golfer.name,
          bid_amount: cost,
          keeper: true,
          nominating_team_id: teamId,
        });
      });
    }
  }

  let auctionRound = keeperSlots + 1;
  let nominatorIdx = 0;
  while (teamIds.some((id) => (byId.get(id)?.roster.length ?? 0) < rosterSlots)) {
    const started = nominatorIdx;
    while ((byId.get(teamIds[nominatorIdx]!)?.roster.length ?? 0) >= rosterSlots) {
      nominatorIdx = (nominatorIdx + 1) % teamIds.length;
      if (nominatorIdx === started) break;
    }
    const nominator = teamIds[nominatorIdx]!;
    if ((byId.get(nominator)?.roster.length ?? 0) >= rosterSlots) break;

    const golfer = board[cursor];
    cursor += 1;
    if (!golfer) throw new Error("draft exhausted pool");

    const maxBids = new Map<number, number>();
    for (const tid of teamIds) {
      const open = rosterSlots - (byId.get(tid)?.roster.length ?? 0);
      if (open <= 0) continue;
      maxBids.set(tid, (budgets.get(tid) ?? 0) - (open - 1));
    }
    const eligible = [...maxBids.entries()].filter(([, bid]) => bid >= 1);
    if (!eligible.length) throw new Error("auction stalled: no team can bid $1");

    eligible.sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      const ra = byId.get(a[0])!.roster.length;
      const rb = byId.get(b[0])!.roster.length;
      if (ra !== rb) return ra - rb;
      return a[0] - b[0];
    });
    const [winner, winnerMax] = eligible[0]!;
    const others = eligible.slice(1).map(([, bid]) => bid);
    let price = others.length ? Math.min(winnerMax, Math.max(...others) + 1) : 1;
    price = Math.max(1, Math.min(price, winnerMax));

    const team = byId.get(winner)!;
    const slot = team.roster.length < starters ? "GS" : "BE";
    team.roster.push(playerRow(golfer, slot));
    budgets.set(winner, (budgets.get(winner) ?? 0) - price);
    const pickNum =
      draft.filter((p) => p.round === auctionRound).length + 1;
    draft.push({
      round: auctionRound,
      round_pick: pickNum,
      team_id: winner,
      player_id: golfer.id,
      player_name: golfer.name,
      bid_amount: price,
      keeper: false,
      nominating_team_id: nominator,
    });

    nominatorIdx = (nominatorIdx + 1) % teamIds.length;
    if (nominatorIdx === 0) auctionRound += 1;
  }

  return {
    draft,
    players: uniquePlayers(teams),
    free_agents: board.slice(cursor).map((g) => playerRow(g, "FA")),
  };
}

export function runGolfDraft(
  teams: DraftTeam[],
  style: "snake" | "auction",
  options: DraftOptions,
): {
  draft: GolfDraftPick[];
  players: GolfPlayerRow[];
  free_agents: GolfPlayerRow[];
} {
  if (style === "auction") return runAuctionDraft(teams, options);
  return runSnakeDraft(teams, options);
}

/** Per-team spent / remaining from auction (or keeper) picks. */
export function draftBudgetRows(
  teams: Array<{ team_id: number; name: string; abbrev?: string | null }>,
  picks: GolfDraftPick[],
  budget: number,
): Array<{
  team_id: number;
  name: string;
  abbrev: string;
  spent: number;
  remaining: number;
  keepers: number;
  picks: number;
}> {
  return teams.map((team) => {
    const mine = picks.filter((p) => p.team_id === team.team_id);
    const spent = mine.reduce((sum, p) => sum + (p.bid_amount ?? 0), 0);
    return {
      team_id: team.team_id,
      name: team.name,
      abbrev: team.abbrev || team.name,
      spent,
      remaining: Math.max(0, budget - spent),
      keepers: mine.filter((p) => p.keeper).length,
      picks: mine.length,
    };
  });
}
