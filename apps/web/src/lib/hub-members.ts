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
