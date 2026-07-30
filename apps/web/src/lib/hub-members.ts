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
  created_at: string;
  updated_at: string;
};

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

export function upsertMember(
  file: HubMembersFile,
  input: {
    email: string;
    role?: HubMemberRole;
    teams?: HubMemberTeamLink[];
  },
  now = new Date(),
): HubMembersFile {
  const email = normalizeEmail(input.email);
  if (!email || !email.includes("@")) {
    throw new Error("valid email is required");
  }
  const iso = now.toISOString();
  const existing = findMember(file, email);
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

  const members = existing
    ? file.members.map((m) => (m.email === email ? next : m))
    : [...file.members, next];

  return {
    schema_version: 1,
    updated_at: iso,
    members: members.sort((a, b) => a.email.localeCompare(b.email)),
  };
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
    };
  }
  if (!ctx.email) {
    return {
      allowedTeamIds: [],
      canControlAuction: false,
      canFinalizeAuction: false,
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
      hint: "Ask an admin to link your franchise for this league in /admin.",
    };
  }
  return {
    allowedTeamIds: [link.team_id],
    canControlAuction: true,
    canFinalizeAuction: false,
    hint: link.team_name
      ? `Acting as ${link.team_name}.`
      : `Acting as team ${link.team_id}.`,
  };
}
