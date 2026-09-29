import { afterEach, describe, expect, it } from "vitest";

import type { LeagueSnapshot, Player } from "@/lib/data";
import {
  dfoLevel,
  espnLevel,
  espnNewsUrl,
  formatInjuryDigest,
  injuryDiscordEnabled,
  injuryFeedEvents,
  injuryNews,
  lineupAlerts,
  type HockeyInjuryLog,
  type InjuryLogPlayer,
} from "@/lib/hockey-alerts";
import type { HockeyBio, HockeyLinesSnapshot } from "@/lib/hockey-nhl";
import { withHockeyAlerts, type HomeLeagueCard } from "@/lib/member-home";

function player(id: number, slot: string, partial: Partial<Player> = {}): Player {
  return {
    id,
    name: `P${id}`,
    position: "C",
    slot,
    pro_team: "BOS",
    injury_status: "ACTIVE",
    status: "ONTEAM",
    total_points: 0,
    projected_total_points: null,
    avg_points: null,
    ...partial,
  } as Player;
}

function bio(nhlId: number, team: string, partial: Partial<HockeyBio> = {}): HockeyBio {
  return {
    nhlId,
    age: 25,
    heightIn: 72,
    weightLb: 190,
    team,
    priorTeam: null,
    evMin: null,
    ppMin: null,
    toiBasis: null,
    role: null,
    pp: null,
    linemates: [],
    teamUrl: null,
    roleBasis: null,
    injury: null,
    possibleScratch: false,
    ...partial,
  };
}

const DAY = "2026-10-10";

const roster = [
  player(1, "F", { injury_status: "OUT" }), // injured starter (high)
  player(2, "D", { injury_status: "QUESTIONABLE" }), // day-to-day starter (medium)
  player(3, "IR", { injury_status: "ACTIVE" }), // healthy on IR
  player(4, "G", { position: "G" }), // goalie whose partner is confirmed
  player(5, "BE", { position: "G" }), // named starter on the bench
  player(6, "F"), // possible scratch
  player(7, "BE", { injury_status: "ACTIVE" }), // sources disagree
  player(8, "BE", { injury_status: "OUT" }), // hurt but benched: no lineup alert
];

const league = {
  league_id: "hockey-main",
  season: 2027,
  name: "Strictly Jayers Hockey",
  sport: "hockey",
  teams: [
    { team_id: 1, name: "Five Hole Heroes", roster },
    { team_id: 2, name: "Crease Crashers", roster: [] },
  ],
} as unknown as LeagueSnapshot;

function logged(espn: string | null, dfo: string | null, level: 0 | 1 | 2): InjuryLogPlayer {
  return { name: null, team_id: 1, slot: null, nhl_team: null, espn, dfo, level, since: DAY };
}

const log: HockeyInjuryLog = {
  league_id: "hockey-main",
  season: 2027,
  updated_at: `${DAY}T11:00:00+00:00`,
  baseline: false,
  players: { "7": logged("ACTIVE", "dtd", 1) },
  events: [
    { id: "1:a", at: `${DAY}T11:00:00+00:00`, espn_id: "1", name: "P1", team_id: 1, nhl_team: "BOS",
      kind: "hurt", from: "healthy", to: "out", espn: "OUT", dfo: null, source: "sync" },
    { id: "9:a", at: "2026-10-09T11:00:00+00:00", espn_id: "9", name: "P9", team_id: 2, nhl_team: "TOR",
      kind: "nearing_return", from: "out", to: "day-to-day", espn: "DAY_TO_DAY", dfo: "dtd", source: "sync" },
    { id: "10:a", at: "2026-10-09T11:00:00+00:00", espn_id: "10", name: "FA", team_id: null, nhl_team: "MTL",
      kind: "hurt", from: "healthy", to: "out", espn: "OUT", dfo: null, source: "sync" },
    { id: "11:a", at: "2026-09-01T11:00:00+00:00", espn_id: "11", name: "Old", team_id: 1, nhl_team: "BOS",
      kind: "back", from: "out", to: "healthy", espn: "ACTIVE", dfo: null, source: "sync" },
  ],
};

const lines = {
  generated_at: `${DAY}T22:30:00+00:00`,
  goalie_starts: {
    "904": { [DAY]: { status: "Confirmed", opp: "TOR", home: true } }, // P4's partner
    "905": { [DAY]: { status: "Likely", opp: "MTL", home: false } }, // P5 is the named starter
  },
} as unknown as HockeyLinesSnapshot;

const bios = {
  "4": bio(804, "BOS"),
  "5": bio(905, "NYR"),
  "6": bio(806, "BOS", { possibleScratch: true }),
  "99": bio(904, "BOS"), // the partner (not on this fantasy team)
};

describe("levels", () => {
  it("mirrors nhl.injuries", () => {
    expect(espnLevel("ACTIVE")).toBe(0);
    expect(espnLevel("DOUBTFUL")).toBe(1);
    expect(espnLevel("INJURY_RESERVE")).toBe(2);
    expect(espnLevel(null)).toBeNull();
    expect(dfoLevel("ltir")).toBe(2);
    expect(dfoLevel("gtd")).toBe(1);
    expect(dfoLevel(null)).toBeNull();
  });
});

describe("lineup alerts", () => {
  const alerts = lineupAlerts(league, 1, log, lines, bios, DAY);
  const byKind = (kind: string) => alerts.filter((a) => a.kind === kind).map((a) => a.espnId);

  it("flags each lineup problem", () => {
    expect(byKind("injured_starter")).toEqual(["1", "2"]);
    expect(byKind("healthy_on_ir")).toEqual(["3"]);
    expect(byKind("goalie_not_starting")).toEqual(["4"]);
    expect(byKind("starter_on_bench")).toEqual(["5"]);
    expect(byKind("scratch_in_lineup")).toEqual(["6"]);
    expect(byKind("sources_disagree")).toEqual(["7"]);
    expect(alerts.some((a) => a.espnId === "8" && a.kind === "injured_starter")).toBe(false);
  });

  it("orders by severity and links ESPN news", () => {
    expect(alerts[0]!.severity).toBe("high");
    expect(alerts.at(-1)!.severity).toBe("low");
    expect(alerts[0]!.newsUrl).toBe(espnNewsUrl("1"));
    expect(alerts.find((a) => a.espnId === "2")!.severity).toBe("medium");
  });

  it("is empty for an unknown team", () => {
    expect(lineupAlerts(league, 99, log, lines, bios, DAY)).toEqual([]);
  });

  it("ignores an unconfirmed partner", () => {
    const soft = {
      ...lines,
      goalie_starts: { "904": { [DAY]: { status: "Unconfirmed", opp: "TOR", home: true } } },
    } as unknown as HockeyLinesSnapshot;
    expect(lineupAlerts(league, 1, log, soft, bios, DAY).some((a) => a.kind === "goalie_not_starting")).toBe(false);
  });
});

describe("injury news", () => {
  it("keeps rostered players in the window, newest first", () => {
    const news = injuryNews(log, league);
    expect(news.map((n) => n.espn_id)).toEqual(["1", "9"]);
    expect(news[0]!.headline).toBe("P1 is out");
    expect(news[1]!.teamName).toBe("Crease Crashers");
    expect(news[1]!.headline).toContain("nearing a return");
    expect(injuryNews(log, league, { teamId: 2 }).map((n) => n.espn_id)).toEqual(["9"]);
    expect(injuryNews(null, league)).toEqual([]);
  });

  it("becomes feed events and a Discord message", () => {
    const events = injuryFeedEvents(log, league);
    expect(events[0]!.kind).toBe("injury");
    expect(events[0]!.teamIds).toEqual([1]);
    expect(events[0]!.href).toContain("view=alerts");
    const msg = formatInjuryDigest(league, injuryNews(log, league));
    expect(msg).toContain("Strictly Jayers Hockey");
    expect(msg).toContain("**P1** (Five Hole Heroes) is out");
    expect(msg).toContain(espnNewsUrl("9"));
  });
});

describe("Discord switch", () => {
  afterEach(() => {
    delete process.env.SJ_HOCKEY_INJURY_DISCORD;
  });

  it("is off unless SJ_HOCKEY_INJURY_DISCORD=1", () => {
    expect(injuryDiscordEnabled()).toBe(false);
    process.env.SJ_HOCKEY_INJURY_DISCORD = "true";
    expect(injuryDiscordEnabled()).toBe(false);
    process.env.SJ_HOCKEY_INJURY_DISCORD = "1";
    expect(injuryDiscordEnabled()).toBe(true);
  });
});

describe("member home", () => {
  const card = {
    leagueId: "hockey-main",
    season: 2027,
    team: { teamId: 1 },
    actions: [{ id: "injuries-hockey-main", tone: "attention", label: "ESPN-only nudge" }],
  } as unknown as HomeLeagueCard;

  it("swaps the ESPN-only nudge for one alerts action", () => {
    const next = withHockeyAlerts(card, lineupAlerts(league, 1, log, lines, bios, DAY));
    expect(next.actions.map((a) => a.id)).toEqual(["hockey-alerts-hockey-main"]);
    expect(next.actions[0]!.tone).toBe("urgent");
    expect(next.actions[0]!.href).toContain("view=alerts&team=1");
  });

  it("drops the nudge and adds nothing when only FYIs remain", () => {
    const fyi = [{ severity: "low" as const, name: "P7", text: "disagree" }];
    expect(withHockeyAlerts(card, fyi).actions).toEqual([]);
  });
});
