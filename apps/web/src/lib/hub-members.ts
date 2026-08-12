/**
 * Hub member ACL — emails + ESPN/hub franchise links (admin center).
 * Pure helpers; disk I/O lives in hub-members-store.ts.
 */

export type HubMemberRole = "admin" | "member";

export type HubMemberTeamLink = {
  league_id: string;
  team_id: number;
  /** Cached label for UI; refreshed when linking. */
  team_name?: string;
  league_name?: string;
};

export type HubMember = {
  email: string;
  role: HubMemberRole;
  teams: HubMemberTeamLink[];
  /**
   * Public handle for feed / reactions (roadmap 7.6). Optional — falls back to
   * Google name / email local-part when unset.
   */
  display_name?: string;
  /**
   * HTTPS avatar URL (usually Google profile photo) synced on sign-in
   * (roadmap 7.10b). Optional — UI falls back to a monogram.
   */
  image_url?: string;
  /**
   * Short public blurb on `/u/{handle}` (roadmap 7.12). Optional plain text.
   */
  bio?: string;
  created_at: string;
  updated_at: string;
};

const IMAGE_URL_MAX = 512;

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 24;
/** Letters, numbers, spaces, and a few punctuation marks. */
const DISPLAY_NAME_RE = /^[A-Za-z0-9 ._'-]+$/;

/** Short public bio — one short paragraph on the profile page. */
export const BIO_MAX = 280;

export type HubMembersFile = {
  schema_version: 1;
  updated_at: string;
  members: HubMember[];
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emptyMembersFile(now = new Date()): HubMembersFile {
  return {
    schema_version: 1,
    updated_at: now.toISOString(),
    members: [],
  };
}

export function parseAllowedEmailsEnv(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter(Boolean);
}

/** Sign-in allowlist = env emails ∪ persisted member emails. */
export function effectiveAllowlist(
  envEmails: string[],
  file: HubMembersFile | null,
): Set<string> {
  const allow = new Set(envEmails);
  for (const member of file?.members ?? []) {
    allow.add(normalizeEmail(member.email));
  }
  return allow;
}

export function findMember(
  file: HubMembersFile,
  email: string,
): HubMember | undefined {
  const key = normalizeEmail(email);
  return file.members.find((m) => m.email === key);
}

export function adminEmails(file: HubMembersFile): string[] {
  return file.members
    .filter((m) => m.role === "admin")
    .map((m) => m.email);
}

/**
 * Who may open /admin.
 * - Explicit admin role in hub_members.json
 * - Bootstrap: no admins yet → any env allowlist / ADMIN_EMAILS address
 * - AUTH_DEV_BYPASS handled by caller
 */
export function canAccessAdmin(
  email: string | null | undefined,
  file: HubMembersFile | null,
  opts?: { envAllowlist?: string[]; adminEmailsEnv?: string[] },
): boolean {
  if (!email) return false;
  const key = normalizeEmail(email);
  const members = file?.members ?? [];
  const admins = members.filter((m) => m.role === "admin");
  if (admins.some((m) => m.email === key)) return true;
  if (admins.length > 0) return false;

  const bootstrap = new Set([
    ...(opts?.adminEmailsEnv ?? []),
    ...(opts?.envAllowlist ?? []),
  ]);
  return bootstrap.has(key);
}

/** Normalize / validate a public username. Empty string clears the handle. */
export function validateDisplayName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return "";
  if (name.length < DISPLAY_NAME_MIN || name.length > DISPLAY_NAME_MAX) {
    throw new Error(
      `username must be ${DISPLAY_NAME_MIN}–${DISPLAY_NAME_MAX} characters`,
    );
  }
  if (!DISPLAY_NAME_RE.test(name)) {
    throw new Error(
      "username can only use letters, numbers, spaces, and . _ ' -",
    );
  }
  return name;
}

/** Prefer custom handle, then an explicit fallback (Google name / email). */
export function resolveMemberDisplayName(
  member: HubMember | null | undefined,
  fallback: string,
): string {
  const custom = member?.display_name?.trim();
  if (custom) return custom;
  const fb = fallback.trim();
  if (fb) return fb;
  return member?.email?.split("@")[0] || "Member";
}

/**
 * URL slug for `/u/{handle}` (roadmap 7.12).
 * Custom username when set; otherwise email local-part. Never the full email.
 */
export function slugifyProfileHandle(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/['.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "member";
}

export function memberProfileHandle(member: HubMember): string {
  const custom = member.display_name?.trim();
  if (custom) return slugifyProfileHandle(custom);
  const local = member.email.split("@")[0] || "member";
  return slugifyProfileHandle(local);
}

export function findMemberByHandle(
  file: HubMembersFile | null | undefined,
  handle: string,
): HubMember | undefined {
  const key = slugifyProfileHandle(handle);
  if (!key) return undefined;
  return (file?.members ?? []).find((m) => memberProfileHandle(m) === key);
}

/**
 * Reject username / local-part slugs that collide with another member
 * (case-insensitive slug match).
 */
export function assertUniqueProfileHandle(
  file: HubMembersFile,
  email: string,
  displayName: string,
): void {
  const self = normalizeEmail(email);
  const validated = validateDisplayName(displayName);
  const next: HubMember = {
    email: self,
    role: "member",
    teams: [],
    created_at: "",
    updated_at: "",
  };
  if (validated) next.display_name = validated;

  const slug = memberProfileHandle(next);
  for (const other of file.members) {
    if (normalizeEmail(other.email) === self) continue;
    if (memberProfileHandle(other) === slug) {
      throw new Error("that username is already taken");
    }
  }
}

/** email → profile handle for feed author links. */
export function memberHandleMap(
  file: HubMembersFile | null | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const member of file?.members ?? []) {
    map[normalizeEmail(member.email)] = memberProfileHandle(member);
  }
  return map;
}

/** HTTPS-only avatar URLs; empty string clears. */
export function validateImageUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return "";
  if (url.length > IMAGE_URL_MAX) {
    throw new Error(`image URL must be ≤ ${IMAGE_URL_MAX} characters`);
  }
  if (!/^https:\/\//i.test(url)) {
    throw new Error("image URL must be https");
  }
  return url;
}

/**
 * Normalize / validate a public bio. Empty string clears.
 * Plain text only — collapses whitespace, caps length, strips control chars.
 */
export function validateBio(raw: string): string {
  const text = [...raw.replace(/\r\n?/g, "\n")]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      if (ch === "\n" || ch === "\t") return true;
      return code >= 32 && code !== 127;
    })
    .join("")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  if (!text) return "";
  if (text.length > BIO_MAX) {
    throw new Error(`bio must be ≤ ${BIO_MAX} characters`);
  }
  return text;
}

/** email → current display_name for live feed joins. */
export function memberDisplayNameMap(
  file: HubMembersFile | null | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const member of file?.members ?? []) {
    const name = member.display_name?.trim();
    if (name) map[normalizeEmail(member.email)] = name;
  }
  return map;
}

/** email → avatar URL for feed / chrome (roadmap 7.10b). */
export function memberImageMap(
  file: HubMembersFile | null | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const member of file?.members ?? []) {
    const url = member.image_url?.trim();
    if (url && /^https:\/\//i.test(url)) {
      map[normalizeEmail(member.email)] = url;
    }
  }
  return map;
}

export function upsertMember(
  file: HubMembersFile,
  input: {
    email: string;
    role?: HubMemberRole;
    teams?: HubMemberTeamLink[];
    /** Pass `null` to clear; omit to leave unchanged. */
    display_name?: string | null;
    /** Pass `null` to clear; omit to leave unchanged. */
    image_url?: string | null;
    /** Pass `null` to clear; omit to leave unchanged. */
    bio?: string | null;
  },
  now = new Date(),
): HubMembersFile {
  const email = normalizeEmail(input.email);
  if (!email || !email.includes("@")) {
    throw new Error("valid email is required");
  }
  const iso = now.toISOString();
  const existing = findMember(file, email);

  let display_name: string | undefined = existing?.display_name;
  if (input.display_name !== undefined) {
    const validated = validateDisplayName(input.display_name ?? "");
    display_name = validated || undefined;
  }

  let image_url: string | undefined = existing?.image_url;
  if (input.image_url !== undefined) {
    const validated = validateImageUrl(input.image_url ?? "");
    image_url = validated || undefined;
  }

  let bio: string | undefined = existing?.bio;
  if (input.bio !== undefined) {
    const validated = validateBio(input.bio ?? "");
    bio = validated || undefined;
  }

  const next: HubMember = existing
    ? {
        ...existing,
        role: input.role ?? existing.role,
        teams: input.teams ?? existing.teams,
        updated_at: iso,
      }
    : {
        email,
        role: input.role ?? "member",
        teams: input.teams ?? [],
        created_at: iso,
        updated_at: iso,
      };

  if (display_name) next.display_name = display_name;
  else delete next.display_name;

  if (image_url) next.image_url = image_url;
  else delete next.image_url;

  if (bio) next.bio = bio;
  else delete next.bio;

  const members = existing
    ? file.members.map((m) => (m.email === email ? next : m))
    : [...file.members, next];

  return {
    schema_version: 1,
    updated_at: iso,
    members: members.sort((a, b) => a.email.localeCompare(b.email)),
  };
}

/** Self-service username write — creates a member row if needed. */
export function setMemberDisplayName(
  file: HubMembersFile,
  email: string,
  displayName: string,
  now = new Date(),
): HubMembersFile {
  assertUniqueProfileHandle(file, email, displayName);
  return upsertMember(
    file,
    { email, display_name: displayName },
    now,
  );
}

/** Self-service bio write — creates a member row if needed. */
export function setMemberBio(
  file: HubMembersFile,
  email: string,
  bio: string,
  now = new Date(),
): HubMembersFile {
  return upsertMember(file, { email, bio }, now);
}

/**
 * Persist Google avatar on sign-in (roadmap 7.10b).
 * No-op (same object) when the URL is unchanged so callers can skip writes.
 */
export function setMemberImageUrl(
  file: HubMembersFile,
  email: string,
  imageUrl: string | null | undefined,
  now = new Date(),
): HubMembersFile {
  const url = validateImageUrl(imageUrl ?? "");
  const existing = findMember(file, email);
  if ((existing?.image_url ?? "") === url) return file;
  if (!existing && !url) return file;
  return upsertMember(file, { email, image_url: url || null }, now);
}

export function removeMember(
  file: HubMembersFile,
  email: string,
  now = new Date(),
): HubMembersFile {
  const key = normalizeEmail(email);
  return {
    schema_version: 1,
    updated_at: now.toISOString(),
    members: file.members.filter((m) => m.email !== key),
  };
}

export function setMemberTeams(
  file: HubMembersFile,
  email: string,
  teams: HubMemberTeamLink[],
  now = new Date(),
): HubMembersFile {
  const existing = findMember(file, email);
  if (!existing) throw new Error("member not found");
  // Dedupe by league_id (one franchise per league).
  const byLeague = new Map<string, HubMemberTeamLink>();
  for (const link of teams) {
    if (!link.league_id || !Number.isInteger(link.team_id)) continue;
    byLeague.set(link.league_id, {
      league_id: link.league_id,
      team_id: link.team_id,
      ...(link.team_name ? { team_name: link.team_name } : {}),
      ...(link.league_name ? { league_name: link.league_name } : {}),
    });
  }
  return upsertMember(
    file,
    { email, teams: [...byLeague.values()] },
    now,
  );
}

export function teamLinkForLeague(
  member: HubMember | undefined,
  leagueId: string,
): HubMemberTeamLink | undefined {
  return member?.teams.find((t) => t.league_id === leagueId);
}

/**
 * Every franchise a member is linked to, keyed by league (roadmap 7.1).
 * Golf ACL asks "may this email act as team N?"; the hub UI asks the broader
 * "which team is this member's, in each league?" so standings, matchups, and
 * the decision tools can lead with it.
 */
export function memberFranchises(
  file: HubMembersFile | null,
  email: string | null | undefined,
): HubMemberTeamLink[] {
  if (!email) return [];
  const member = findMember(file ?? emptyMembersFile(), email);
  if (!member) return [];
  // One franchise per league is enforced on write; dedupe defensively so a
  // hand-edited file cannot make the UI pick a different team per render.
  const byLeague = new Map<string, HubMemberTeamLink>();
  for (const link of member.teams) {
    if (!link?.league_id || !Number.isInteger(link.team_id)) continue;
    if (!byLeague.has(link.league_id)) byLeague.set(link.league_id, link);
  }
  return [...byLeague.values()];
}

export type FranchiseAclOk = { ok: true; mode: "bypass" | "linked" };
export type FranchiseAclDeny = { ok: false; error: string };
export type FranchiseAclResult = FranchiseAclOk | FranchiseAclDeny;

export type FranchiseAclContext = {
  email: string | null | undefined;
  file: HubMembersFile | null;
  leagueId: string;
  envAllowlist?: string[];
  adminEmailsEnv?: string[];
  /** AUTH_DEV_BYPASS — local/e2e multi-team tooling. */
  devBypass?: boolean;
};

function adminOpts(ctx: FranchiseAclContext) {
  return {
    envAllowlist: ctx.envAllowlist,
    adminEmailsEnv: ctx.adminEmailsEnv,
  };
}

/** Commissioner / bootstrap admin / local bypass may act as any franchise. */
export function canBypassFranchiseAcl(ctx: FranchiseAclContext): boolean {
  if (ctx.devBypass) return true;
  return canAccessAdmin(ctx.email, ctx.file, adminOpts(ctx));
}

/**
 * Team-scoped mutations (auction nominate/bid/pass, lineup save).
 * Admins and AUTH_DEV_BYPASS may use any team_id; members must match their
 * linked franchise for the league.
 */
export function assertCanActAsTeam(
  ctx: FranchiseAclContext & { teamId: number },
): FranchiseAclResult {
  if (canBypassFranchiseAcl(ctx)) {
    return { ok: true, mode: "bypass" };
  }
  if (!ctx.email) {
    return { ok: false, error: "sign in required" };
  }
  const member = findMember(ctx.file ?? emptyMembersFile(), ctx.email);
  const link = teamLinkForLeague(member, ctx.leagueId);
  if (!link) {
    return {
      ok: false,
      error:
        "No franchise linked for this league. Ask an admin to link your team in /admin.",
    };
  }
  if (link.team_id !== ctx.teamId) {
    const label = link.team_name ?? `team ${link.team_id}`;
    return {
      ok: false,
      error: `You can only act as ${label}.`,
    };
  }
  return { ok: true, mode: "linked" };
}

/**
 * Open/start auction room — admin, or any member linked to the league.
 */
export function assertCanControlAuction(
  ctx: FranchiseAclContext,
): FranchiseAclResult {
  if (canBypassFranchiseAcl(ctx)) {
    return { ok: true, mode: "bypass" };
  }
  if (!ctx.email) {
    return { ok: false, error: "sign in required" };
  }
  const member = findMember(ctx.file ?? emptyMembersFile(), ctx.email);
  if (teamLinkForLeague(member, ctx.leagueId)) {
    return { ok: true, mode: "linked" };
  }
  return {
    ok: false,
    error:
      "Link a franchise for this league in /admin (or ask an admin) before controlling the auction.",
  };
}

/**
 * League feed posts (comments, reactions, polls, votes) — same bar as auction
 * control: linked franchise for the league, or admin / AUTH_DEV_BYPASS.
 */
export function assertCanPostToFeed(
  ctx: FranchiseAclContext,
): FranchiseAclResult {
  const result = assertCanControlAuction(ctx);
  if (result.ok) return result;
  return {
    ok: false,
    error:
      "Link a franchise for this league in /admin (or ask an admin) before posting to the feed.",
  };
}

/** Soft-delete comments/polls — admin / bypass only. */
export function assertCanModerateFeed(
  ctx: FranchiseAclContext,
): FranchiseAclResult {
  if (canBypassFranchiseAcl(ctx)) {
    return { ok: true, mode: "bypass" };
  }
  return {
    ok: false,
    error: "Only an admin can moderate the feed.",
  };
}

/** Finalize writes draft/rosters — admin / bypass only. */
export function assertCanFinalizeAuction(
  ctx: FranchiseAclContext,
): FranchiseAclResult {
  if (canBypassFranchiseAcl(ctx)) {
    return { ok: true, mode: "bypass" };
  }
  return {
    ok: false,
    error: "Only an admin can finalize the auction.",
  };
}

/** UI scope for golf auction / lineup panels. */
export type GolfActingScope = {
  allowedTeamIds: number[];
  canControlAuction: boolean;
  canFinalizeAuction: boolean;
  /** Admin-only Discord tee-time lineup reminders (roadmap 7.7). */
  canSendReminders: boolean;
  hint?: string;
};

export function golfActingScope(
  ctx: FranchiseAclContext,
  leagueTeamIds: number[],
): GolfActingScope {
  if (canBypassFranchiseAcl(ctx)) {
    return {
      allowedTeamIds: [...leagueTeamIds],
      canControlAuction: true,
      canFinalizeAuction: true,
      canSendReminders: true,
    };
  }
  if (!ctx.email) {
    return {
      allowedTeamIds: [],
      canControlAuction: false,
      canFinalizeAuction: false,
      canSendReminders: false,
      hint: "Sign in to act in this league.",
    };
  }
  const member = findMember(ctx.file ?? emptyMembersFile(), ctx.email);
  const link = teamLinkForLeague(member, ctx.leagueId);
  if (!link || !leagueTeamIds.includes(link.team_id)) {
    return {
      allowedTeamIds: [],
      canControlAuction: false,
      canFinalizeAuction: false,
      canSendReminders: false,
      hint: "Ask an admin to link your franchise for this league in /admin.",
    };
  }
  return {
    allowedTeamIds: [link.team_id],
    canControlAuction: true,
    canFinalizeAuction: false,
    canSendReminders: false,
    hint: link.team_name
      ? `Acting as ${link.team_name}.`
      : `Acting as team ${link.team_id}.`,
  };
}
