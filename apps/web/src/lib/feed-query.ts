/**
 * Feed list query helpers — date range + sort direction (newest-first default).
 */

export type FeedSortDir = "asc" | "desc";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Accept `YYYY-MM-DD` (HTML date input). Returns UTC midnight ms, or null. */
export function parseFeedDayStart(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(ms) ? null : ms;
}

/** Inclusive end of `YYYY-MM-DD` in UTC (last ms of that day). */
export function parseFeedDayEnd(value: string | null | undefined): number | null {
  const start = parseFeedDayStart(value);
  if (start == null) return null;
  return start + DAY_MS - 1;
}

export function parseFeedSortDir(
  value: string | null | undefined,
): FeedSortDir {
  return value === "asc" ? "asc" : "desc";
}

export function inFeedDateRange(
  sortKeyMs: number,
  fromMs: number | null,
  toMs: number | null,
): boolean {
  if (fromMs != null && sortKeyMs < fromMs) return false;
  if (toMs != null && sortKeyMs > toMs) return false;
  return true;
}

export function compareFeedSortKey(
  a: number,
  b: number,
  dir: FeedSortDir,
): number {
  return dir === "asc" ? a - b : b - a;
}

/** Sort by numeric key; stable tie-break on id string. */
export function sortByFeedKey<T>(
  items: T[],
  keyOf: (item: T) => number,
  idOf: (item: T) => string,
  dir: FeedSortDir,
): T[] {
  return [...items].sort((a, b) => {
    const byKey = compareFeedSortKey(keyOf(a), keyOf(b), dir);
    if (byKey !== 0) return byKey;
    return idOf(a).localeCompare(idOf(b));
  });
}

export function isoCreatedAtMs(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}
