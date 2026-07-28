import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { SJ_SNAPSHOTS_CACHE_TAG } from "@/lib/cache-tags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Explicit snapshot-cache invalidation for sj-sync / operators.
 *
 * Auth: `Authorization: Bearer $SJ_REVALIDATE_SECRET`. When the secret is
 * unset, the route returns 503 so a misconfigured webhook fails loudly
 * instead of becoming an open purge endpoint.
 *
 * Best-effort from sync: see `sj.sync.notify_hub_revalidate`. TTL on
 * `unstable_cache` still bounds staleness across Cloud Run instances.
 */
export async function POST(request: Request) {
  const secret = process.env.SJ_REVALIDATE_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "SJ_REVALIDATE_SECRET is not configured" },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (header !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  revalidateTag(SJ_SNAPSHOTS_CACHE_TAG);
  return NextResponse.json({
    ok: true,
    revalidated: true,
    tag: SJ_SNAPSHOTS_CACHE_TAG,
  });
}
