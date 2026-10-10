import { createHash } from "crypto";
import { inflateRawSync } from "zlib";

import { parseInstant } from "@/lib/timezone";
import type { Workout } from "@/lib/vibe-document";

/**
 * Streaming-ish Apple Health `export.xml` Workout extractor.
 *
 * A full export can be hundreds of MB. We scan chunks for `<Workout …>`
 * start tags (self-closing or with children) and never build a DOM.
 */

const WORKOUT_TAG = /<Workout\b([^>]*?)(\/?)>/g;

function attr(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : null;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function humanizeAppleType(raw: string): string {
  const trimmed = raw.replace(/^HKWorkoutActivityType/, "").trim();
  if (!trimmed) return "Workout";
  return trimmed.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function toSeconds(duration: string | null, unit: string | null): number | null {
  const n = Number(duration);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = (unit || "min").toLowerCase();
  if (u.startsWith("sec")) return n;
  if (u.startsWith("hr") || u.startsWith("hour")) return n * 3600;
  return n * 60;
}

function toKcal(energy: string | null, unit: string | null): number | null {
  const n = Number(energy);
  if (!Number.isFinite(n)) return null;
  const u = (unit || "kcal").toLowerCase();
  if (u === "kj" || u.startsWith("kilojoule")) return n / 4.184;
  return n;
}

function toMeters(distance: string | null, unit: string | null): number | null {
  const n = Number(distance);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = (unit || "m").toLowerCase();
  if (u.startsWith("km")) return n * 1000;
  if (u.startsWith("mi")) return n * 1609.344;
  if (u.startsWith("yd") || u.startsWith("yard")) return n * 0.9144;
  if (u.startsWith("ft") || u.startsWith("feet")) return n * 0.3048;
  return n;
}

function workoutFromAttrs(attrs: string): Workout | null {
  const startRaw = attr(attrs, "startDate");
  const endRaw = attr(attrs, "endDate");
  const start = startRaw ? parseInstant(startRaw) : null;
  const end = endRaw ? parseInstant(endRaw) : null;
  if (!start || !end || end.getTime() < start.getTime()) return null;
  const typeRaw =
    attr(attrs, "workoutActivityType") || attr(attrs, "name") || "Workout";
  const name = humanizeAppleType(typeRaw);
  const duration_sec =
    toSeconds(attr(attrs, "duration"), attr(attrs, "durationUnit")) ??
    Math.round((end.getTime() - start.getTime()) / 1000);
  const source_id = createHash("sha256")
    .update(
      `ah:${typeRaw}|${start.toISOString()}|${end.toISOString()}`,
    )
    .digest("hex")
    .slice(0, 24);
  return {
    id: `ah:${source_id}`,
    source: "apple_health",
    source_id,
    name,
    type: name,
    start: start.toISOString(),
    end: end.toISOString(),
    duration_sec: Math.round(duration_sec),
    active_energy_kcal: toKcal(
      attr(attrs, "totalEnergyBurned"),
      attr(attrs, "totalEnergyBurnedUnit"),
    ),
    distance_m: toMeters(
      attr(attrs, "totalDistance"),
      attr(attrs, "totalDistanceUnit"),
    ),
    avg_hr: null,
    max_hr: null,
  };
}

export function parseAppleHealthWorkouts(xml: string): Workout[] {
  const out: Workout[] = [];
  const seen = new Set<string>();
  WORKOUT_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORKOUT_TAG.exec(xml))) {
    const workout = workoutFromAttrs(match[1] ?? "");
    if (!workout || seen.has(workout.source_id)) continue;
    seen.add(workout.source_id);
    out.push(workout);
  }
  return out;
}

/**
 * Feed XML in chunks. Keeps a tail so a `<Workout` split across chunks
 * is not dropped. Call `finish()` after the last chunk.
 */
export function createAppleHealthWorkoutScanner() {
  let carry = "";
  const out: Workout[] = [];
  const seen = new Set<string>();

  function consume(buffer: string, allowPartial: boolean) {
    const lastOpen = buffer.lastIndexOf("<Workout");
    const lastClose = buffer.lastIndexOf(">");
    let scan = buffer;
    if (allowPartial && lastOpen > lastClose) {
      carry = buffer.slice(lastOpen);
      scan = buffer.slice(0, lastOpen);
    } else {
      carry = "";
    }
    for (const workout of parseAppleHealthWorkouts(scan)) {
      if (seen.has(workout.source_id)) continue;
      seen.add(workout.source_id);
      out.push(workout);
    }
  }

  return {
    push(chunk: string) {
      consume(carry + chunk, true);
    },
    finish(): Workout[] {
      if (carry) consume(carry, false);
      return out;
    },
  };
}

const LOCAL_FILE_SIG = 0x04034b50;

function readU16(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset);
}

function readU32(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

/**
 * Pull `export.xml` (or `apple_health_export/export.xml`) out of an
 * Apple Health export.zip without extra dependencies.
 */
export function extractExportXmlFromZip(buf: Buffer): string | null {
  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (readU32(buf, offset) !== LOCAL_FILE_SIG) {
      offset += 1;
      continue;
    }
    const method = readU16(buf, offset + 8);
    const compSize = readU32(buf, offset + 18);
    const nameLen = readU16(buf, offset + 26);
    const extraLen = readU16(buf, offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > buf.length) return null;
    const name = buf.subarray(nameStart, nameEnd).toString("utf8");
    const dataStart = nameEnd + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > buf.length) return null;
    const isExportXml =
      name === "export.xml" ||
      name.endsWith("/export.xml") ||
      name === "apple_health_export/export.xml";
    if (isExportXml) {
      const data = buf.subarray(dataStart, dataEnd);
      if (method === 0) return data.toString("utf8");
      if (method === 8) {
        return inflateRawSync(data).toString("utf8");
      }
      throw new Error(`unsupported zip compression method ${method}`);
    }
    offset = dataEnd;
  }
  return null;
}
