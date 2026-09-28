/** @vitest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DataTable, type DataTableColumn } from "@/components/DataTable";

type Row = { id: string; name: string; position: string; points: number };

function makeRows(count: number): Row[] {
  const positions = ["QB", "RB", "WR", "TE"];
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    name: `Player ${String(index + 1).padStart(2, "0")}`,
    position: positions[index % positions.length],
    points: 100 - index,
  }));
}

const columns: DataTableColumn<Row>[] = [
  {
    id: "position",
    header: "Pos",
    sortable: true,
    filterable: true,
    filterValue: (row) => row.position,
    sortValue: (row) => row.position,
    cell: (row) => row.position,
  },
  {
    id: "name",
    header: "Player",
    sortable: true,
    sortValue: (row) => row.name,
    cell: (row) => row.name,
  },
  {
    id: "points",
    header: "Pts",
    sortable: true,
    defaultSortDirection: "desc",
    numeric: true,
    sortValue: (row) => row.points,
    cell: (row) => row.points,
  },
];

describe("DataTable RTL (roadmap 1.2)", () => {
  it("filters rows by search input", async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        rows={makeRows(12)}
        columns={columns}
        getRowKey={(row) => row.id}
        searchText={(row) => `${row.name} ${row.position}`}
        pageSize={25}
      />,
    );

    await user.type(screen.getByPlaceholderText("Search…"), "Player 03");
    expect(screen.getByText("Player 03")).toBeInTheDocument();
    expect(screen.queryByText("Player 01")).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 1–1 of 1/)).toBeInTheDocument();
  });

  it("narrows rows with a position filter chip", async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        rows={makeRows(12)}
        columns={columns}
        getRowKey={(row) => row.id}
        searchText={(row) => row.name}
        pageSize={25}
      />,
    );

    await user.click(screen.getByRole("button", { name: "QB" }));
    const body = screen.getByRole("table").querySelector("tbody")!;
    const names = within(body)
      .getAllByRole("row")
      .map((row) => within(row).getAllByRole("cell")[1]?.textContent);
    expect(names.every((name) => name?.startsWith("Player"))).toBe(true);
    expect(names).toHaveLength(3); // 12 rows / 4 positions
    expect(screen.getByText(/of 3/)).toBeInTheDocument();
  });

  it("cycles sort via header button and aria-sort", async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        rows={makeRows(4)}
        columns={columns}
        getRowKey={(row) => row.id}
        searchText={(row) => row.name}
        pageSize={25}
      />,
    );

    const pointsHeader = screen.getByRole("columnheader", { name: /Pts/ });
    expect(pointsHeader).toHaveAttribute("aria-sort", "none");

    await user.click(screen.getByRole("button", { name: /Pts/ }));
    expect(pointsHeader).toHaveAttribute("aria-sort", "descending");
    const body = screen.getByRole("table").querySelector("tbody")!;
    const firstDesc = within(body).getAllByRole("row")[0];
    expect(within(firstDesc).getByText("Player 01")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Pts/ }));
    expect(pointsHeader).toHaveAttribute("aria-sort", "ascending");
    const firstAsc = within(body).getAllByRole("row")[0];
    expect(within(firstAsc).getByText("Player 04")).toBeInTheDocument();
  });

  it("paginates and shows empty message when nothing matches", async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        rows={makeRows(30)}
        columns={columns}
        getRowKey={(row) => row.id}
        searchText={(row) => row.name}
        pageSize={10}
        emptyMessage="No players match."
      />,
    );

    expect(screen.getByText(/Showing 1–10 of 30/)).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Showing 11–20 of 30/)).toBeInTheDocument();
    expect(screen.getByText("Player 11")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search…"), "zzz-nope");
    expect(screen.getByText("No players match.")).toBeInTheDocument();
    expect(screen.getByText("No results")).toBeInTheDocument();
  });
});
