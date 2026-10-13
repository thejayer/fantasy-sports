import { createHash } from "crypto";

import { parseInstant } from "@/lib/timezone";
import type { AgentRun, Workout } from "@/lib/vibe-document";

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function headerIndex(headers: string[], names: string[]): number {
  const lower = headers.map((h) => h.toLowerCase().replace(/[\s_]+/g, ""));
  for (const name of names) {
    const key = name.toLowerCase().replace(/[\s_]+/g, "");
    const idx = lower.indexOf(key);
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * Hevy-style (or generic) workout CSV. Looks for start/end/type columns
 * under several common header names. Low-priority fallback ingest.
 */
export function parseHevyWorkoutCsv(text: string): Workout[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const startIdx = headerIndex(headers, [
    "start",
    "start_time",
    "starttime",
    "date",
    "workout_start",
  ]);
  const endIdx = headerIndex(headers, ["end", "end_time", "endtime", "workout_end"]);
  const typeIdx = headerIndex(headers, [
    "type",
    "name",
    "title",
    "workout",
    "workout_title",
  ]);
  if (startIdx < 0) return [];
  const out: Workout[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const start = parseInstant(cols[startIdx] ?? "");
    if (!start) continue;
    const end = parseInstant(cols[endIdx] ?? "") ?? start;
    const name = (cols[typeIdx] ?? "").trim() || "Workout";
    if (end.getTime() < start.getTime()) continue;
    const source_id = createHash("sha256")
      .update(`hevy:${name}|${start.toISOString()}|${end.toISOString()}`)
      .digest("hex")
      .slice(0, 24);
    if (seen.has(source_id)) continue;
    seen.add(source_id);
    out.push({
      id: `hevy:${source_id}`,
      source: "hevy",
      source_id,
      name,
      type: name,
      start: start.toISOString(),
      end: end.toISOString(),
      duration_sec: Math.round((end.getTime() - start.getTime()) / 1000),
      active_energy_kcal: null,
      distance_m: null,
      avg_hr: null,
      max_hr: null,
    });
  }
  return out;
}

/** Agent-run CSV: start,end,label (header optional if the first row parses). */
export function parseAgentRunCsv(text: string): AgentRun[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  let start = 0;
  const headers = splitCsvLine(lines[0]).map((h) =>
    h.toLowerCase().replace(/[\s_]+/g, ""),
  );
  const looksHeader =
    headers.includes("start") ||
    headers.includes("starttime") ||
    headers.includes("began");
  let startIdx = 0;
  let endIdx = 1;
  let labelIdx = 2;
  if (looksHeader) {
    startIdx = Math.max(0, headerIndex(headers, ["start", "start_time", "began"]));
    endIdx = headerIndex(headers, ["end", "end_time", "finished"]);
    if (endIdx < 0) endIdx = 1;
    labelIdx = headerIndex(headers, ["label", "title", "name"]);
    start = 1;
  }
  const out: AgentRun[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(start)) {
    const cols = splitCsvLine(line);
    const from = parseInstant(cols[startIdx] ?? "");
    const to = parseInstant(cols[endIdx] ?? "");
    if (!from || !to || to.getTime() <= from.getTime()) continue;
    const label = (cols[labelIdx] ?? "").trim() || null;
    const id = createHash("sha256")
      .update(`agent:${from.toISOString()}|${to.toISOString()}|${label ?? ""}`)
      .digest("hex")
      .slice(0, 24);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id: `agent:${id}`,
      start: from.toISOString(),
      end: to.toISOString(),
      label,
      source: "csv",
    });
  }
  return out;
}
