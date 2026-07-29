import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { SJ_SNAPSHOTS_CACHE_TAG } from "@/lib/cache-tags";
import {
  buildGolfSnapshot,
  type CreateGolfLeagueInput,
  validateCreateGolfLeague,
  writeGolfLeagueSnapshot,
} from "@/lib/golf";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await requireSession();

  let body: Partial<CreateGolfLeagueInput>;
  try {
    body = (await request.json()) as Partial<CreateGolfLeagueInput>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const input: CreateGolfLeagueInput = {
    league_id: String(body.league_id ?? ""),
    name: String(body.name ?? ""),
    short_name: body.short_name ? String(body.short_name) : undefined,
    season: Number(body.season),
    format: (body.format as CreateGolfLeagueInput["format"]) ?? "h2h",
    team_count: Number(body.team_count),
    bench: Number(body.bench),
    missed_cut:
      (body.missed_cut as CreateGolfLeagueInput["missed_cut"]) ?? "alt1",
    draft_style:
      (body.draft_style as CreateGolfLeagueInput["draft_style"]) ?? "snake",
    keepers: Boolean(body.keepers),
    multipliers: {
      regular: Number(body.multipliers?.regular ?? 1),
      signature: Number(body.multipliers?.signature ?? 1.5),
      major: Number(body.multipliers?.major ?? 2),
    },
  };

  const error = validateCreateGolfLeague(input);
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const snapshot = buildGolfSnapshot(input);
    const written = await writeGolfLeagueSnapshot(snapshot);
    revalidateTag(SJ_SNAPSHOTS_CACHE_TAG, "max");
    return NextResponse.json({
      ok: true,
      league_id: snapshot.league_id,
      season: snapshot.season,
      path: written.path,
    });
  } catch (err) {
    console.error("[sj-hub] golf create failed", err);
    return NextResponse.json(
      { error: "failed to write golf league snapshot" },
      { status: 500 },
    );
  }
}
