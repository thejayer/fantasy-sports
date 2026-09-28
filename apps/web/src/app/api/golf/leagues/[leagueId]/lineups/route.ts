import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { SJ_SNAPSHOTS_CACHE_TAG } from "@/lib/cache-tags";
import { getLeagueSnapshot } from "@/lib/data";
import {
  applyLocks,
  golfSettingsFromLeagueSettings,
  lineupClock,
  validateWeekLineup,
  type GolfWeekLineup,
} from "@/lib/golf-lineup";
import { saveGolfTeamLineup } from "@/lib/golf-lineup-store";
import { enforceTeamAction } from "@/lib/franchise-acl";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ leagueId: string }> };

export async function POST(request: Request, { params }: Props) {
  await requireSession();
  const { leagueId } = await params;

  let body: {
    season?: number;
    team_id?: number;
    event_id?: string;
    starters?: number[];
    captain?: number;
    alt1?: number | null;
    alt2?: number | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const season = Number(body.season);
  const teamId = Number(body.team_id);
  const eventId = String(body.event_id ?? "");
  if (!Number.isInteger(season) || !Number.isInteger(teamId) || !eventId) {
    return NextResponse.json(
      { error: "season, team_id, and event_id are required" },
      { status: 400 },
    );
  }

  const denied = await enforceTeamAction(leagueId, teamId);
  if (denied) return denied;

  const league = await getLeagueSnapshot(leagueId, season);
  if (!league || league.sport !== "golf") {
    return NextResponse.json({ error: "golf league not found" }, { status: 404 });
  }
  if (!league.lineups?.events?.length) {
    return NextResponse.json(
      { error: "league has no lineup events yet" },
      { status: 400 },
    );
  }

  const team = league.teams.find((t) => t.team_id === teamId);
  if (!team) {
    return NextResponse.json({ error: "team not found" }, { status: 404 });
  }
  const event = league.lineups.events.find((e) => e.event_id === eventId);
  if (!event) {
    return NextResponse.json({ error: "event not found" }, { status: 404 });
  }

  const golf = golfSettingsFromLeagueSettings(league.settings);
  const rosterIds = new Set(
    team.roster
      .map((p) => (p.id == null ? null : Number(p.id)))
      .filter((id): id is number => id != null && !Number.isNaN(id)),
  );
  const previous = league.lineups.teams[String(teamId)]?.[eventId] ?? null;
  const now = lineupClock(league.synced_at);
  const draft = {
    starters: (body.starters ?? []).map(Number),
    captain: Number(body.captain),
    alt1: body.alt1 == null ? null : Number(body.alt1),
    alt2: body.alt2 == null ? null : Number(body.alt2),
  };
  const error = validateWeekLineup(draft, {
    rosterIds,
    golf,
    teeTimes: event.tee_times,
    previous,
    now,
    events: league.lineups.events,
    teamLineups: league.lineups.teams[String(teamId)],
    eventId,
  });
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const saved_at = new Date().toISOString();
  const lineup: GolfWeekLineup = applyLocks(
    {
      ...draft,
      saved_at,
      locked_at: previous?.locked_at ?? null,
      locks: previous?.locks ?? {},
      source: "manual",
    },
    event.tee_times,
    now,
  );

  try {
    const written = await saveGolfTeamLineup({
      league,
      teamId,
      eventId,
      lineup,
    });
    revalidateTag(SJ_SNAPSHOTS_CACHE_TAG, "max");
    return NextResponse.json({
      ok: true,
      league_id: leagueId,
      season,
      team_id: teamId,
      event_id: eventId,
      path: written.path,
      lineup,
    });
  } catch (err) {
    console.error("[sj-hub] golf lineup save failed", err);
    return NextResponse.json(
      { error: "failed to save golf lineup" },
      { status: 500 },
    );
  }
}
