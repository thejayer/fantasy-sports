import { NextResponse } from "next/server";

import { buildHealthReport } from "@/lib/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public liveness + snapshot-freshness probe.
 *
 * Auth is bypassed in middleware for this path. Returns HTTP 200 when every
 * latest-season snapshot is within `SJ_HEALTH_STALE_SECONDS` (default 2h),
 * otherwise 503 so uptime checks can page on stale or missing data.
 */
export async function GET() {
  const report = await buildHealthReport();
  return NextResponse.json(report, { status: report.ok ? 200 : 503 });
}
