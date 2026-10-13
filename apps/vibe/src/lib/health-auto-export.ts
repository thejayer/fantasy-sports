import { createHash } from "crypto";

import { parseInstant } from "@/lib/timezone";
import type { Workout } from "@/lib/vibe-document";

/**
 * Health Auto Export (HealthyApps) workout JSON — Version 2 documented at
 * https://help.healthyapps.dev/en/health-auto-export/export-format/workouts
 *
 * REST automations wrap rows. We accept, defensively:
 *   { data: { workouts: [...] } }
 *   { workouts: [...] }
 *   { data: [...] }
 *   [ workout, ... ]
 *   a single workout object
 *
 * Dates are `yyyy-MM-dd HH:mm:ss Z` (e.g. "2024-02-06 07:00:00 -0800").
 * Energy may be `activeEnergyBurned` (v2) or `activeEnergy` (v1).
 */

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function qtyNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const rec = asRecord(raw);
  if (!rec) return null;
  const n = Number(rec.qty);
  return Number.isFinite(n) ? n : null;
}

function qtyUnits(raw: unknown): string {
  const rec = asRecord(raw);
  return typeof rec?.units === "string" ? rec.units.toLowerCase() : "";
}

function toKcal(raw: unknown): number | null {
  const n = qtyNumber(raw);
  if (n == null) return null;
  const units = qtyUnits(raw);
  if (units === "kj" || units === "kilojoule") return n / 4.184;
  return n;
}

function toMeters(raw: unknown): number | null {
  const n = qtyNumber(raw);
  if (n == null) return null;
  const units = qtyUnits(raw);
  if (units === "km" || units === "kilometer" || units === "kilometers") {
    return n * 1000;
  }
  if (units === "mi" || units === "mile" || units === "miles") {
    return n * 1609.344;
  }
  if (units === "yd" || units === "yard" || units === "yards") {
    return n * 0.9144;
  }
  if (units === "ft" || units === "feet") return n * 0.3048;
  return n;
}

function heartAvg(row: Record<string, unknown>): number | null {
  const summary = asRecord(row.heartRate);
  const fromSummary = qtyNumber(summary?.avg);
  if (fromSummary != null) return fromSummary;
  return qtyNumber(row.avgHeartRate) ?? qtyNumber(row.heartRateAverage);
}

function heartMax(row: Record<string, unknown>): number | null {
  const summary = asRecord(row.heartRate);
  const fromSummary = qtyNumber(summary?.max);
  if (fromSummary != null) return fromSummary;
  return qtyNumber(row.maxHeartRate);
}

function extractWorkoutArrays(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = asRecord(payload);
  if (!root) return [];
  if (Array.isArray(root.workouts)) return root.workouts;
  const data = root.data;
  if (Array.isArray(data)) return data;
  const dataRec = asRecord(data);
  if (dataRec && Array.isArray(dataRec.workouts)) return dataRec.workouts;
  if (root.name && (root.start || root.startDate)) return [root];
  if (dataRec && dataRec.name && (dataRec.start || dataRec.startDate)) {
    return [dataRec];
  }
  return [];
}

function fallbackId(name: string, start: string, end: string): string {
  return createHash("sha256")
    .update(`hae:${name}|${start}|${end}`)
    .digest("hex")
    .slice(0, 24);
}

export function parseHealthAutoExport(payload: unknown): Workout[] {
  const out: Workout[] = [];
  const seen = new Set<string>();
  for (const raw of extractWorkoutArrays(payload)) {
    const row = asRecord(raw);
    if (!row) continue;
    const name =
      (typeof row.name === "string" && row.name.trim()) ||
      (typeof row.workoutActivityType === "string" &&
        row.workoutActivityType.trim()) ||
      "Workout";
    const startRaw =
      (typeof row.start === "string" && row.start) ||
      (typeof row.startDate === "string" && row.startDate) ||
      "";
    const endRaw =
      (typeof row.end === "string" && row.end) ||
      (typeof row.endDate === "string" && row.endDate) ||
      "";
    const start = parseInstant(startRaw);
    const end = parseInstant(endRaw);
    if (!start || !end || end.getTime() < start.getTime()) continue;
    const durationRaw = Number(row.duration);
    const duration_sec =
      Number.isFinite(durationRaw) && durationRaw > 0
        ? Math.round(durationRaw)
        : Math.round((end.getTime() - start.getTime()) / 1000);
    const source_id =
      (typeof row.id === "string" && row.id.trim()) ||
      fallbackId(name, start.toISOString(), end.toISOString());
    if (seen.has(source_id)) continue;
    seen.add(source_id);
    out.push({
      id: `hae:${source_id}`,
      source: "health_auto_export",
      source_id,
      name,
      type: name,
      start: start.toISOString(),
      end: end.toISOString(),
      duration_sec,
      active_energy_kcal:
        toKcal(row.activeEnergyBurned) ?? toKcal(row.activeEnergy),
      distance_m: toMeters(row.distance),
      avg_hr: heartAvg(row),
      max_hr: heartMax(row),
    });
  }
  return out;
}
