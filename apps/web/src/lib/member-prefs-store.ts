/**
 * Per-member hockey tags / notes (HOCKEY-PORT.md H8) under SJ_HUB_DIR:
 * `{hub}/{leagueId}/member_prefs/{emailHash}.json`.
 *
 * One file per member per league (tags describe players, not seasons). The
 * file name is a hash of the lower-cased email, so no address appears in
 * the store's paths. Uncached — each member only ever reads their own file.
 */

import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { hubDataRoot } from "@/lib/hub-paths";
import { emptyPrefs, type MemberPrefs } from "@/lib/member-prefs";

export function emailKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24);
}

function prefsPath(leagueId: string, email: string): string {
  return path.join(hubDataRoot(), leagueId, "member_prefs", `${emailKey(email)}.json`);
}

export async function readMemberPrefs(leagueId: string, email: string): Promise<MemberPrefs> {
  try {
    const parsed = JSON.parse(await fs.readFile(prefsPath(leagueId, email), "utf8")) as MemberPrefs;
    return {
      ...emptyPrefs(leagueId),
      ...parsed,
      players: parsed.players && typeof parsed.players === "object" ? parsed.players : {},
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyPrefs(leagueId);
    throw err;
  }
}

export async function writeMemberPrefs(email: string, prefs: MemberPrefs): Promise<void> {
  const filePath = prefsPath(prefs.league_id, email);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}
