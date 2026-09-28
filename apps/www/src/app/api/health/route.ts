import { NextResponse } from "next/server";

/** Cloud Run / uptime probe — no store dependencies. */
export function GET() {
  return NextResponse.json({ ok: true, service: "sj-www" });
}
