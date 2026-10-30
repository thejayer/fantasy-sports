/**
 * Today's casino summary for the home page (top 3 + hot machines).
 *
 * Fetched on the server through the same authenticated proxy path as /casino
 * (lib/casino-proxy.ts: Google ID token, identity headers, casino origin
 * pinned), so the casino service stays private. The result is the same for
 * every member, so it is cached in memory for a short time and shared;
 * if the casino is slow or down the last good copy is served for a few
 * minutes, then nothing (the home page hides the box).
 *
 * The casino's JSON is validated and trimmed here: only display names,
 * chips and machine labels ever reach the browser.
 */

import { CASINO_BASE_PATH, proxyCasino } from "@/lib/casino-proxy";
import type { CasinoMember } from "@/lib/casino-identity";

export const SUMMARY_PATH = `${CASINO_BASE_PATH}/api/home-summary`;
/** Fresh for this long; one upstream request refreshes it for everyone. */
export const SUMMARY_TTL_MS = 30_000;
/** After a failed refresh, wait this long before asking the casino again. */
export const SUMMARY_RETRY_MS = 10_000;
/** A failed refresh may serve the last good copy for this long. */
export const SUMMARY_STALE_MS = 5 * 60_000;
export const SUMMARY_TIMEOUT_MS = 4_000;
const NAME_MAX_CHARS = 40;
const TAGS = ["loose", "fair", "snug", "tight"] as const;

export type SummaryTag = (typeof TAGS)[number];
export type SummaryTop = { rank: number; name: string; value: number };
export type SummaryHot = {
  machine: string;
  name: string;
  tag: SummaryTag;
  tagLabel: string;
  spins: number;
  wins: number;
  jackpots: number;
};
export type CasinoSummary = {
  date: string;
  top: SummaryTop[];
  hot: SummaryHot[];
  players: number;
};

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

/** A display label: trimmed, control characters removed, never an email. */
function label(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!clean || clean.includes("@")) return fallback;
  return Array.from(clean).slice(0, NAME_MAX_CHARS).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate the casino's /api/home-summary JSON; null when it is not that. */
export function parseSummary(raw: unknown): CasinoSummary | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.top) || !Array.isArray(raw.hot)) return null;
  const top: SummaryTop[] = [];
  for (const row of raw.top.slice(0, 3)) {
    if (!isRecord(row)) return null;
    const rank = count(row.rank);
    const value = count(row.value);
    if (rank === null || value === null) return null;
    top.push({ rank, name: label(row.name, "Player"), value });
  }
  const hot: SummaryHot[] = [];
  for (const row of raw.hot.slice(0, 3)) {
    if (!isRecord(row)) return null;
    const spins = count(row.spins);
    const wins = count(row.wins);
    const jackpots = count(row.jackpots);
    const tag = TAGS.find((t) => t === row.tag);
    if (spins === null || wins === null || jackpots === null || !tag) return null;
    const name = label(row.name, "");
    if (!name) return null;
    hot.push({
      machine: label(row.machine, name),
      name,
      tag,
      tagLabel: label(row.tagLabel, tag),
      spins,
      wins,
      jackpots,
    });
  }
  return {
    date: label(raw.date, ""),
    top,
    hot,
    players: count(raw.players) ?? top.length,
  };
}

export type SummaryDeps = {
  getMember: () => Promise<CasinoMember | null>;
  /** Passed through to proxyCasino (tests). */
  proxy?: Partial<Parameters<typeof proxyCasino>[1]>;
  now?: () => number;
};

type Entry = { summary: CasinoSummary; at: number };

/**
 * A small shared cache. One instance per process; tests make their own.
 */
export function createSummaryCache() {
  let good: Entry | null = null;
  let failedAt = 0;
  let inflight: Promise<CasinoSummary | null> | null = null;

  async function refresh(deps: SummaryDeps, now: number): Promise<CasinoSummary | null> {
    try {
      const request = new Request(`http://portal.internal${SUMMARY_PATH}`, {
        headers: { accept: "application/json" },
      });
      const res = await proxyCasino(request, {
        getMember: deps.getMember,
        timeoutMs: SUMMARY_TIMEOUT_MS,
        ...deps.proxy,
      });
      if (res.ok) {
        const summary = parseSummary(await res.json());
        if (summary) {
          good = { summary, at: now };
          failedAt = 0;
          return summary;
        }
      }
    } catch {
      // Falls through to the failure path.
    }
    failedAt = now;
    return null;
  }

  return {
    /** The summary, or null when the casino can't supply a recent one. */
    async get(deps: SummaryDeps): Promise<CasinoSummary | null> {
      const now = (deps.now ?? Date.now)();
      if (good && now - good.at < SUMMARY_TTL_MS) return good.summary;
      const stale = good && now - good.at < SUMMARY_STALE_MS ? good.summary : null;
      if (failedAt && now - failedAt < SUMMARY_RETRY_MS) return stale;
      inflight ??= refresh(deps, now).finally(() => {
        inflight = null;
      });
      return (await inflight) ?? stale;
    },
    reset() {
      good = null;
      failedAt = 0;
      inflight = null;
    },
  };
}

const shared = createSummaryCache();

export function getCasinoSummary(deps: SummaryDeps): Promise<CasinoSummary | null> {
  return shared.get(deps);
}
