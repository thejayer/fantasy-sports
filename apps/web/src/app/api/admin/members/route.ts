import { NextResponse } from "next/server";

import {
  getLatestLeagues,
  getLeagueSnapshot,
} from "@/lib/data";
import {
  removeMember,
  setMemberTeams,
  upsertMember,
  type HubMemberRole,
  type HubMemberTeamLink,
} from "@/lib/hub-members";
import {
  readHubMembers,
  writeHubMembers,
} from "@/lib/hub-members-store";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

type Body = {
  email?: string;
  role?: HubMemberRole;
  teams?: HubMemberTeamLink[];
};

export async function GET() {
  await requireAdmin();
  const file = await readHubMembers();
  const leagues = await getLatestLeagues();
  const leagueOptions = [];
  for (const item of leagues) {
    const snap = await getLeagueSnapshot(item.league_id, item.season);
    if (!snap) continue;
    leagueOptions.push({
      league_id: item.league_id,
      name: item.name,
      sport: item.sport,
      season: item.season,
      teams: snap.teams.map((t) => ({
        team_id: t.team_id,
        name: t.name,
        abbrev: t.abbrev,
        owners: t.owners,
      })),
    });
  }
  return NextResponse.json({ members: file.members, leagues: leagueOptions });
}

export async function POST(request: Request) {
  await requireAdmin();
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const email = String(body.email ?? "");
  try {
    const file = await readHubMembers();
    const next = upsertMember(file, {
      email,
      role: body.role === "admin" ? "admin" : "member",
      teams: body.teams,
    });
    const written = await writeHubMembers(next);
    return NextResponse.json({ members: written.members }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to add member" },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  await requireAdmin();
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const email = String(body.email ?? "");
  try {
    let file = await readHubMembers();
    if (body.role) {
      file = upsertMember(file, { email, role: body.role });
    }
    if (body.teams) {
      // Enrich labels from current snapshots when possible.
      const leagues = await getLatestLeagues();
      const enriched: HubMemberTeamLink[] = [];
      for (const link of body.teams) {
        const meta = leagues.find((l) => l.league_id === link.league_id);
        const snap = meta
          ? await getLeagueSnapshot(link.league_id, meta.season)
          : null;
        const team = snap?.teams.find((t) => t.team_id === link.team_id);
        enriched.push({
          league_id: link.league_id,
          team_id: link.team_id,
          team_name: team?.name ?? link.team_name,
          league_name: meta?.name ?? link.league_name,
        });
      }
      file = setMemberTeams(file, email, enriched);
    } else if (body.role) {
      // already upserted
    } else {
      return NextResponse.json(
        { error: "role or teams required" },
        { status: 400 },
      );
    }
    const written = await writeHubMembers(file);
    return NextResponse.json({ members: written.members });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to update member" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  await requireAdmin();
  const url = new URL(request.url);
  const email = url.searchParams.get("email") || "";
  try {
    const file = await readHubMembers();
    const next = removeMember(file, email);
    const written = await writeHubMembers(next);
    return NextResponse.json({ members: written.members });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to remove member" },
      { status: 400 },
    );
  }
}
