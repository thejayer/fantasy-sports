/**
 * Timezone helpers. Workout and event instants are stored as UTC ISO strings.
 * Calendar bucketing (week, weekday, hour, "today") uses the member timezone.
 *
 * Offset math uses Intl so DST transitions in America/Chicago are honest:
 * spring-forward (2am → 3am) and fall-back (2am → 1am) do not shift a
 * duration expressed in milliseconds.
 */

export const DEFAULT_TIMEZONE = "America/Chicago";

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday … 6 = Saturday
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function part(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  return parts.find((row) => row.type === type)?.value ?? "";
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(timeZone: string | null | undefined): string {
  const value = timeZone?.trim() || DEFAULT_TIMEZONE;
  return isValidTimeZone(value) ? value : DEFAULT_TIMEZONE;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const tz = resolveTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return {
    year: Number(part(parts, "year")),
    month: Number(part(parts, "month")),
    day: Number(part(parts, "day")),
    hour: Number(part(parts, "hour")),
    minute: Number(part(parts, "minute")),
    second: Number(part(parts, "second")),
    weekday: WEEKDAY_INDEX[part(parts, "weekday")] ?? 0,
  };
}

/** Offset of `timeZone` at `date`, in milliseconds (UTC = local - offset). */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const z = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    z.year,
    z.month - 1,
    z.day,
    z.hour,
    z.minute,
    z.second,
  );
  return asUtc - date.getTime();
}

/**
 * Instant for a civil datetime in `timeZone`. On a spring-forward gap the
 * clock jumps forward; we land on the first valid instant after the gap.
 * On a fall-back overlap we pick the earlier (DST) occurrence.
 */
export function zonedLocalToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = guess - tzOffsetMs(new Date(guess), timeZone);
  const adjusted = guess - tzOffsetMs(new Date(first), timeZone);
  return new Date(adjusted);
}

export function startOfZonedDay(date: Date, timeZone: string): Date {
  const z = zonedParts(date, timeZone);
  return zonedLocalToUtc(timeZone, z.year, z.month, z.day, 0, 0, 0);
}

/** US week: Sunday 00:00 in the member timezone. */
export function startOfZonedWeek(date: Date, timeZone: string): Date {
  const start = startOfZonedDay(date, timeZone);
  const weekday = zonedParts(start, timeZone).weekday;
  return new Date(start.getTime() - weekday * 24 * 60 * 60 * 1000);
}

export function addCalendarDays(
  date: Date,
  days: number,
  timeZone: string,
): Date {
  const z = zonedParts(date, timeZone);
  return zonedLocalToUtc(timeZone, z.year, z.month, z.day + days, 0, 0, 0);
}

export function zonedDateKey(date: Date, timeZone: string): string {
  const z = zonedParts(date, timeZone);
  const mm = String(z.month).padStart(2, "0");
  const dd = String(z.day).padStart(2, "0");
  return `${z.year}-${mm}-${dd}`;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function parseInstant(raw: string | Date): Date | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const isoish = trimmed.includes("T")
    ? trimmed
    : trimmed.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/, "$1T$2");
  const spacedOffset = isoish.replace(/ ([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(spacedOffset);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatZoned(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    ...options,
  }).format(date);
}
