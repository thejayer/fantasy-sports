/**
 * Hockey monitoring + alerts (HOCKEY-PORT.md H6).
 *
 * Reads the synced `nhl/injury_log.json` (ESPN + Daily Faceoff statuses and
 * their transitions) with the roster's ESPN lineup slots and Daily Faceoff
 * goalie starts. Pure; client-safe. Nothing here calls ESPN or Daily Faceoff.
 */

import type { LeagueSnapshot, Player } from "@/lib/data";
import type { SystemFeedEvent } from "@/lib/feed-events";
import type { HockeyBioIndex, HockeyLinesSnapshot } from "@/lib/hockey-nhl";

export type InjuryLevel = 0 | 1 | 2;

export type InjuryLogPlayer = {
  name: string | null;
  team_id: number | null;
  slot: string | null;
  nhl_team: string | null;
  espn: string | null;
  dfo: string | null;
  level: InjuryLevel;
  since: string;
};

export type InjuryEvent = {
  id: string;
  at: string;
  espn_id: string;
  name: string | null;
  team_id: number | null;
  nhl_team: string | null;
  kind: "hurt" | "nearing_return" | "back";
  from: string;
  to: string;
  espn: string | null;
  dfo: string | null;
  source: string;
};

export type HockeyInjuryLog = {
  league_id: string;
  season: number;
  updated_at: string;
  baseline: boolean;
  players: Record<string, InjuryLogPlayer>;
  events: InjuryEvent[];
};

export function espnNewsUrl(espnId: string | number): string {
  return `https://www.espn.com/nhl/player/news/_/id/${espnId}`;
}

const ESPN_LEVEL: Record<string, InjuryLevel> = {
  ACTIVE: 0,
  NORMAL: 0,
  DAY_TO_DAY: 1,
  QUESTIONABLE: 1,
  DOUBTFUL: 1,
  PROBABLE: 1,
  OUT: 2,
  INJURY_RESERVE: 2,
  SUSPENSION: 2,
};
const DFO_LEVEL: Record<string, InjuryLevel> = { dtd: 1, gtd: 1, out: 2, ir: 2, ltir: 2, suspended: 2 };

/** Mirrors `nhl.injuries.espn_level` (null when ESPN sent nothing). */
export function espnLevel(status: string | null | undefined): InjuryLevel | null {
  if (!status) return null;
  return ESPN_LEVEL[status.toUpperCase()] ?? 0;
}

/** Mirrors `nhl.injuries.dfo_level` for the stored word (null when unlisted). */
export function dfoLevel(word: string | null | undefined): InjuryLevel | null {
  if (!word) return null;
  return DFO_LEVEL[word.toLowerCase()] ?? 1;
}

const STARTER_SLOTS = new Set(["F", "D", "G", "UTIL", "Util", "C", "LW", "RW"]);
const IR_SLOTS = new Set(["IR", "IL"]);
const LEVEL_TEXT = ["healthy", "day-to-day", "out"] as const;

export type AlertSeverity = "high" | "medium" | "low";

export type LineupAlert = {
  id: string;
  kind:
    | "injured_starter"
    | "healthy_on_ir"
    | "goalie_not_starting"
    | "starter_on_bench"
    | "scratch_in_lineup"
    | "sources_disagree";
  severity: AlertSeverity;
  espnId: string;
  name: string;
  text: string;
  newsUrl: string;
};

const SEVERITY_ORDER: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 };

function statusText(p: { espn: string | null; dfo: string | null }): string {
  const parts = [
    p.espn ? `ESPN ${p.espn.replace(/_/g, " ").toLowerCase()}` : null,
    p.dfo ? `Daily Faceoff ${p.dfo.toUpperCase()}` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

/** The day the goalie-start data describes: the Daily Faceoff refresh date. */
export function alertDay(lines: HockeyLinesSnapshot | null | undefined, log: HockeyInjuryLog | null | undefined): string {
  return (lines?.generated_at ?? log?.updated_at ?? new Date().toISOString()).slice(0, 10);
}

/**
 * Alerts for one fantasy team's lineup as of the last sync: injured starter,
 * healthy player on IR, a lineup goalie whose partner is named, a named
 * starter on the bench, a possible scratch in the lineup, and ESPN vs Daily
 * Faceoff disagreeing on an injury.
 */
export function lineupAlerts(
  league: LeagueSnapshot,
  teamId: number | null | undefined,
  log: HockeyInjuryLog | null | undefined,
  lines: HockeyLinesSnapshot | null | undefined,
  bios: HockeyBioIndex,
  day: string = alertDay(lines, log),
): LineupAlert[] {
  const team = league.teams.find((t) => t.team_id === teamId);
  if (!team) return [];
  const starts = lines?.goalie_starts ?? {};
  const alerts: LineupAlert[] = [];
  const push = (p: Player, a: Omit<LineupAlert, "id" | "espnId" | "name" | "newsUrl">) =>
    alerts.push({
      ...a,
      id: `${a.kind}-${p.id}`,
      espnId: String(p.id),
      name: p.name ?? "Player",
      newsUrl: espnNewsUrl(String(p.id)),
    });

  // Named starters by NHL club today (for "partner is starting").
  const namedByClub = new Map<string, { nhlId: string; status: string }>();
  for (const [nhlId, byDate] of Object.entries(starts)) {
    const s = byDate[day];
    if (!s) continue;
    const club = Object.values(bios).find((b) => String(b.nhlId) === nhlId)?.team;
    if (club) namedByClub.set(club, { nhlId, status: s.status });
  }

  for (const p of team.roster ?? []) {
    if (p.id == null) continue;
    const id = String(p.id);
    const logged = log?.players?.[id];
    const espn = logged?.espn ?? p.injury_status ?? null;
    const dfo = logged?.dfo ?? null;
    const eL = espnLevel(espn);
    const dL = dfoLevel(dfo);
    const level = Math.max(eL ?? 0, dL ?? 0) as InjuryLevel;
    const slot = p.slot ?? "";
    const starter = STARTER_SLOTS.has(slot);
    const bio = bios[id];
    const goalie = (p.position ?? "").toUpperCase() === "G" || slot === "G";
    const why = statusText({ espn, dfo });

    if (starter && level > 0) {
      push(p, {
        kind: "injured_starter",
        severity: level === 2 ? "high" : "medium",
        text: `${LEVEL_TEXT[level]} but in your lineup (${slot})${why ? ` — ${why}` : ""}`,
      });
    }
    if (IR_SLOTS.has(slot) && level === 0 && (eL != null || dL != null)) {
      push(p, {
        kind: "healthy_on_ir",
        severity: "medium",
        text: `healthy but on IR — free the slot or activate${why ? ` (${why})` : ""}`,
      });
    }
    if (goalie && bio?.team) {
      const named = namedByClub.get(bio.team);
      const mine = named && named.nhlId === String(bio.nhlId);
      if (starter && named && !mine && named.status !== "Unconfirmed") {
        push(p, {
          kind: "goalie_not_starting",
          severity: named.status === "Confirmed" ? "high" : "medium",
          text: `in your lineup, but ${bio.team}'s ${named.status.toLowerCase()} starter is someone else`,
        });
      }
      if (!starter && !IR_SLOTS.has(slot) && mine && named!.status !== "Unconfirmed") {
        push(p, {
          kind: "starter_on_bench",
          severity: "medium",
          text: `${named!.status.toLowerCase()} to start today but on your bench`,
        });
      }
    }
    if (starter && bio?.possibleScratch && level === 0) {
      push(p, {
        kind: "scratch_in_lineup",
        severity: "medium",
        text: "may be a healthy scratch next game (missing from a full Daily Faceoff lineup)",
      });
    }
    if (eL != null && dL != null && eL !== dL) {
      push(p, {
        kind: "sources_disagree",
        severity: "low",
        text: `ESPN says ${LEVEL_TEXT[eL]}, Daily Faceoff says ${LEVEL_TEXT[dL]}`,
      });
    }
  }
  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// injury news
// ---------------------------------------------------------------------------

export type InjuryNews = InjuryEvent & { teamName: string | null; headline: string };

const KIND_TEXT: Record<InjuryEvent["kind"], (e: InjuryEvent) => string> = {
  hurt: (e) => (e.from === "healthy" ? `is ${e.to}` : `went from ${e.from} to ${e.to}`),
  nearing_return: () => "is nearing a return (out → day-to-day)",
  back: () => "is back (healthy)",
};

/** Rostered players' transitions, newest first, over the last `days`. */
export function injuryNews(
  log: HockeyInjuryLog | null | undefined,
  league: LeagueSnapshot,
  { days = 14, teamId }: { days?: number; teamId?: number | null } = {},
): InjuryNews[] {
  if (!log?.events?.length) return [];
  const latest = log.updated_at.slice(0, 10);
  const cutoff = new Date(`${latest}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const since = cutoff.toISOString().slice(0, 10);
  const names = new Map(league.teams.map((t) => [t.team_id, t.name]));
  return log.events
    .filter((e) => e.team_id != null && e.at.slice(0, 10) >= since)
    .filter((e) => teamId == null || e.team_id === teamId)
    .map((e) => ({
      ...e,
      teamName: names.get(e.team_id!) ?? null,
      headline: `${e.name ?? "Player"} ${KIND_TEXT[e.kind](e)}`,
    }))
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

/** Feed rows for the league Feed (system stream, "all" view). */
export function injuryFeedEvents(log: HockeyInjuryLog | null | undefined, league: LeagueSnapshot): SystemFeedEvent[] {
  return injuryNews(log, league, { days: 30 }).map((n) => {
    const ms = Date.parse(n.at);
    return {
      id: `injury-${n.id}`,
      kind: "injury" as const,
      sortKey: ms,
      occurredAt: new Date(ms).toISOString(),
      dateLabel: new Date(ms).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric" }),
      title: n.headline,
      body: [n.teamName, statusText(n)].filter(Boolean).join(" · "),
      teamIds: n.team_id != null ? [n.team_id] : [],
      playerIds: [Number(n.espn_id)],
      href: `/leagues/${league.league_id}?season=${league.season}&tab=tools&view=alerts`,
    };
  });
}

// ---------------------------------------------------------------------------
// Discord digest
// ---------------------------------------------------------------------------

/** Discord message for unsent injury news (rostered players only). */
export function formatInjuryDigest(league: LeagueSnapshot, news: InjuryNews[]): string {
  const lines = news.map(
    (n) => `• **${n.name ?? "Player"}** (${n.teamName ?? "—"}) ${KIND_TEXT[n.kind](n)} — <${espnNewsUrl(n.espn_id)}>`,
  );
  return [`🏒 **${league.name} — injury news**`, ...lines].join("\n");
}

/** Env switch for the Discord post (off unless `SJ_HOCKEY_INJURY_DISCORD=1`). */
export function injuryDiscordEnabled(): boolean {
  return process.env.SJ_HOCKEY_INJURY_DISCORD === "1";
}
