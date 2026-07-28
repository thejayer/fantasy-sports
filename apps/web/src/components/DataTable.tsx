"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  compareSortValues,
  normalizeSearch,
  paginateRows,
  toggleSortState,
  uniqueSorted,
  type SortDirection,
  type SortState,
} from "@/lib/table";

export type DataTableColumn<T> = {
  id: string;
  header: string;
  sortable?: boolean;
  /** Default sort direction when this column is first clicked. */
  defaultSortDirection?: SortDirection;
  sortValue?: (row: T) => string | number | null | undefined;
  /** When true, values contribute to the position/category filter chips. */
  filterable?: boolean;
  filterValue?: (row: T) => string | null | undefined;
  cell: (row: T) => ReactNode;
  numeric?: boolean;
  /** Narrow leading column (status dots). */
  narrow?: boolean;
};

export type DataTableProps<T> = {
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowKey: (row: T) => string;
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  pageSize?: number;
  emptyMessage?: string;
  initialSort?: SortState;
};

export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  searchText,
  searchPlaceholder = "Search…",
  pageSize = 25,
  emptyMessage = "No rows match.",
  initialSort = null,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>(initialSort);
  const [page, setPage] = useState(1);

  const filterColumn = columns.find((column) => column.filterable);

  const positionOptions = useMemo(() => {
    if (!filterColumn) return [];
    return uniqueSorted(
      rows.map((row) =>
        filterColumn.filterValue
          ? filterColumn.filterValue(row)
          : null,
      ),
    );
  }, [rows, filterColumn]);

  const filtered = useMemo(() => {
    const needle = normalizeSearch(query);
    return rows.filter((row) => {
      if (position && filterColumn) {
        const value = filterColumn.filterValue?.(row) ?? null;
        if (value !== position) return false;
      }
      if (!needle || !searchText) return true;
      return normalizeSearch(searchText(row)).includes(needle);
    });
  }, [rows, query, position, filterColumn, searchText]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const column = columns.find((item) => item.id === sort.columnId);
    if (!column?.sortValue) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) =>
      compareSortValues(column.sortValue!(a), column.sortValue!(b), sort.direction),
    );
    return copy;
  }, [filtered, sort, columns]);

  const { pageRows, pageCount, safePage } = useMemo(
    () => paginateRows(sorted, page, pageSize),
    [sorted, page, pageSize],
  );

  const rangeStart = sorted.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, sorted.length);

  return (
    <div className="data-table">
      <div className="table-toolbar">
        <label className="table-search">
          <span className="sr-only">Search</span>
          <input
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>
        {positionOptions.length > 1 ? (
          <div className="table-filters" role="group" aria-label="Position filter">
            <button
              type="button"
              className={`filter-chip${position == null ? " active" : ""}`}
              onClick={() => {
                setPosition(null);
                setPage(1);
              }}
            >
              All positions
            </button>
            {positionOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={`filter-chip${position === option ? " active" : ""}`}
                onClick={() => {
                  setPosition(option);
                  setPage(1);
                }}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => {
                const ariaSort =
                  sort?.columnId === column.id
                    ? sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none";
                return (
                  <th
                    key={column.id}
                    className={[
                      column.numeric ? "numeric" : "",
                      column.narrow ? "narrow" : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined}
                    aria-sort={column.sortable ? ariaSort : undefined}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        className="sort-button"
                        onClick={() => {
                          setSort(
                            toggleSortState(sort, column.id, {
                              defaultDirection: column.defaultSortDirection ?? "desc",
                            }),
                          );
                          setPage(1);
                        }}
                      >
                        {column.header}
                        <span className="sort-indicator" aria-hidden="true">
                          {sort?.columnId === column.id
                            ? sort.direction === "asc"
                              ? " ▲"
                              : " ▼"
                            : ""}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={getRowKey(row)}>
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={[
                      column.numeric ? "numeric" : "",
                      column.narrow ? "narrow" : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
            {!pageRows.length ? (
              <tr>
                <td colSpan={columns.length}>{emptyMessage}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="table-pager" aria-live="polite">
        <span className="table-pager-meta">
          {sorted.length
            ? `Showing ${rangeStart}–${rangeEnd} of ${sorted.length}`
            : "No results"}
        </span>
        <div className="table-pager-controls">
          <button
            type="button"
            className="button secondary"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
          >
            Previous
          </button>
          <span className="table-pager-page">
            Page {safePage} of {pageCount}
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={safePage >= pageCount}
            onClick={() => setPage(safePage + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
