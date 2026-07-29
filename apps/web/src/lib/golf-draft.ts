/**
 * Offline OWGR pool + snake draft for hub create (roadmap 6.4b).
 * Mirrors `src/sg/pool.py` + `src/sg/draft.py` — fixtures regenerate from Python.
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
  nominating_team_id: null;
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

export function runSnakeDraft(
  teams: DraftTeam[],
  options: { starters?: number; bench: number },
): {
  draft: GolfDraftPick[];
  players: GolfPlayerRow[];
  free_agents: GolfPlayerRow[];
} {
  const starters = options.starters ?? STARTERS;
  const { bench } = options;
  if (teams.length < 2) throw new Error("snake draft needs at least 2 teams");
  const rounds = starters + bench;
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
        keeper: false,
        nominating_team_id: null,
      });
    });
  }

  const seen = new Map<number, GolfPlayerRow>();
  for (const team of teams) {
    for (const player of team.roster) {
      if (!seen.has(player.id)) {
        seen.set(player.id, { ...player, fantasy_team: team.name });
      }
    }
  }
  const players = [...seen.values()].sort(
    (a, b) => a.season_stats.OWGR - b.season_stats.OWGR,
  );
  const free_agents = board.slice(cursor).map((g) => playerRow(g, "FA"));
  return { draft, players, free_agents };
}
