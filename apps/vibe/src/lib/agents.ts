import { createHash } from "crypto";

import { parseInstant } from "@/lib/timezone";
import { parseAgentRunCsv } from "@/lib/hevy-csv";
import type { AgentRun } from "@/lib/vibe-document";

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function runId(start: string, end: string, label: string | null): string {
  return `agent:${createHash("sha256")
    .update(`${start}|${end}|${label ?? ""}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function fromRow(raw: unknown): AgentRun | null {
  const row = asRecord(raw);
  if (!row) return null;
  const start = parseInstant(
    typeof row.start === "string"
      ? row.start
      : typeof row.started_at === "string"
        ? row.started_at
        : "",
  );
  const end = parseInstant(
    typeof row.end === "string"
      ? row.end
      : typeof row.ended_at === "string"
        ? row.ended_at
        : "",
  );
  if (!start || !end || end.getTime() <= start.getTime()) return null;
  const label =
    (typeof row.label === "string" && row.label.trim()) ||
    (typeof row.title === "string" && row.title.trim()) ||
    null;
  return {
    id:
      (typeof row.id === "string" && row.id.trim()) ||
      runId(start.toISOString(), end.toISOString(), label),
    start: start.toISOString(),
    end: end.toISOString(),
    label,
    source: "ingest",
  };
}

/** Cursor cloud-agent windows (beta). Accepts `{runs:[…]}`, an array, or one row. */
export function parseAgentRunsPayload(payload: unknown): AgentRun[] {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return parseAgentRunsPayload(JSON.parse(trimmed));
      } catch {
        return parseAgentRunCsv(trimmed);
      }
    }
    return parseAgentRunCsv(trimmed);
  }
  if (Array.isArray(payload)) {
    return payload.map(fromRow).filter((row): row is AgentRun => !!row);
  }
  const rec = asRecord(payload);
  if (!rec) return [];
  if (Array.isArray(rec.runs)) {
    return rec.runs.map(fromRow).filter((row): row is AgentRun => !!row);
  }
  if (Array.isArray(rec.windows)) {
    return rec.windows.map(fromRow).filter((row): row is AgentRun => !!row);
  }
  const one = fromRow(rec);
  return one ? [one] : [];
}
