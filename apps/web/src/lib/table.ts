/** Pure helpers for the reusable DataTable (roadmap 3.3). */

export type SortDirection = "asc" | "desc";

export type SortState = {
  columnId: string;
  direction: SortDirection;
} | null;

export function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

export function compareSortValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  direction: SortDirection,
): number {
  const empty = direction === "asc" ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return empty;
  if (b == null) return -empty;

  let result = 0;
  if (typeof a === "number" && typeof b === "number") {
    result = a - b;
  } else {
    result = String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }
  return direction === "asc" ? result : -result;
}

export function toggleSortState(
  current: SortState,
  columnId: string,
  options: { defaultDirection?: SortDirection } = {},
): SortState {
  const defaultDirection = options.defaultDirection ?? "desc";
  if (!current || current.columnId !== columnId) {
    return { columnId, direction: defaultDirection };
  }
  if (current.direction === defaultDirection) {
    return {
      columnId,
      direction: defaultDirection === "desc" ? "asc" : "desc",
    };
  }
  return null;
}

export function paginateRows<T>(
  rows: T[],
  page: number,
  pageSize: number,
): { pageRows: T[]; pageCount: number; safePage: number } {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * pageSize;
  return {
    pageRows: rows.slice(start, start + pageSize),
    pageCount,
    safePage,
  };
}

export function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort(
    (a, b) => a.localeCompare(b),
  );
}
