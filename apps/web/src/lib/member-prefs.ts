/**
 * Hockey personal layer (HOCKEY-PORT.md H8): per-member player tags and notes.
 *
 * Private to each member (their own file under the hub store). Tags:
 * - role tags (PP1 / PP2 / No PP, Top 6 / Bottom 6, Top 4 D / Bottom pair,
 *   Starting / Backup goalie) replace the automatic role the tools display
 *   and filter on, for that member only;
 * - **Keep** = the Never-drop list (protected like 85%+ ESPN ownership);
 * - **Watch** = a watchlist (★ on the boards, `watch=1` filter).
 *
 * The value model's role adjustment is off (H2b), so tags never move a
 * player's value — they change what the member sees and what counts as a
 * drop candidate. Pure; client-safe.
 */

import type { HockeyBio, HockeyBioIndex } from "@/lib/hockey-nhl";

export const PP_TAGS = ["PP1", "PP2", "No PP"] as const;
export const LINE_TAGS = ["Top 6", "Bottom 6", "Top 4 D", "Bottom pair", "Starting goalie", "Backup goalie"] as const;
export const LIST_TAGS = ["Watch", "Keep"] as const;
export const MEMBER_TAGS = [...PP_TAGS, ...LINE_TAGS, ...LIST_TAGS] as const;
export type MemberTag = (typeof MEMBER_TAGS)[number];

export const NOTE_MAX = 280;
export const MAX_TAGGED_PLAYERS = 500;

export type PlayerPref = { tags: MemberTag[]; note: string };

export type MemberPrefs = {
  schema_version: 1;
  league_id: string;
  updated_at: string;
  players: Record<string, PlayerPref>;
};

export function emptyPrefs(leagueId: string): MemberPrefs {
  return { schema_version: 1, league_id: leagueId, updated_at: new Date(0).toISOString(), players: {} };
}

const KNOWN = new Set<string>(MEMBER_TAGS);

/**
 * Clean one player's tags + note: known tags only, no duplicates, at most one
 * PP tag and one line tag (the last one wins), note trimmed to NOTE_MAX.
 * Returns null when nothing is left (the player is untagged).
 */
export function sanitizePref(raw: { tags?: unknown; note?: unknown }): PlayerPref | null {
  const input = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [];
  const picked: MemberTag[] = [];
  const lastOf = (group: readonly string[]) => [...input].reverse().find((t) => group.includes(t));
  const pp = lastOf(PP_TAGS);
  const line = lastOf(LINE_TAGS);
  if (pp) picked.push(pp as MemberTag);
  if (line) picked.push(line as MemberTag);
  for (const t of LIST_TAGS) if (input.includes(t)) picked.push(t);
  const note = typeof raw.note === "string" ? raw.note.trim().slice(0, NOTE_MAX) : "";
  const tags = picked.filter((t) => KNOWN.has(t));
  return tags.length || note ? { tags, note } : null;
}

export function isKept(pref: PlayerPref | undefined): boolean {
  return Boolean(pref?.tags.includes("Keep"));
}

export function isWatched(pref: PlayerPref | undefined): boolean {
  return Boolean(pref?.tags.includes("Watch"));
}

const LINE_ROLE: Record<string, string> = {
  "Top 6": "Top 6",
  "Bottom 6": "Bottom 6",
  "Top 4 D": "Top 4 D",
  "Bottom pair": "Bottom pair",
  "Starting goalie": "Starting G",
  "Backup goalie": "Backup G",
};

/** A bio with this member's role / PP tags in place of the automatic ones. */
export function taggedBio(bio: HockeyBio | undefined, pref: PlayerPref | undefined): HockeyBio | undefined {
  if (!bio || !pref?.tags.length) return bio;
  const pp = pref.tags.find((t) => (PP_TAGS as readonly string[]).includes(t));
  const line = pref.tags.find((t) => t in LINE_ROLE);
  if (!pp && !line) return bio;
  return {
    ...bio,
    pp: pp ?? bio.pp,
    role: line ? LINE_ROLE[line]! : bio.role,
    roleBasis: "Your tag",
  };
}

/** Apply a member's tags to the whole bio index (for the decision tools). */
export function taggedBios(bios: HockeyBioIndex, prefs: MemberPrefs | null | undefined): HockeyBioIndex {
  if (!prefs) return bios;
  const out: HockeyBioIndex = { ...bios };
  for (const [id, pref] of Object.entries(prefs.players)) {
    const next = taggedBio(bios[id], pref);
    if (next) out[id] = next;
  }
  return out;
}

/** Merge one player's cleaned pref into the member's document. */
export function upsertPref(prefs: MemberPrefs, espnId: string, pref: PlayerPref | null, now = new Date()): MemberPrefs {
  const players = { ...prefs.players };
  if (pref) players[espnId] = pref;
  else delete players[espnId];
  return { ...prefs, players, updated_at: now.toISOString() };
}
