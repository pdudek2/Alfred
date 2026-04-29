import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SoftFilterBar } from "../components/soft-filter-bar";
import type { TriageTab } from "../lib/run-view-model";

const counts: Record<TriageTab, number> = {
  all: 12,
  live: 3,
  needs: 2,
  done: 7,
};

describe("SoftFilterBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders all four pills with counts", () => {
    render(<SoftFilterBar counts={counts} onQueryChange={vi.fn()} onTabChange={vi.fn()} query="" tab="all" />);

    expect(screen.getByRole("button", { name: "All 12" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Live 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Needs you 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done 7" })).toBeInTheDocument();
  });

  it("marks the active pill as pressed", () => {
    render(<SoftFilterBar counts={counts} onQueryChange={vi.fn()} onTabChange={vi.fn()} query="" tab="needs" />);

    const activeButton = screen.getByRole("button", { name: "Needs you 2" });

    expect(activeButton).toHaveAttribute("aria-pressed", "true");
    expect(activeButton).toHaveClass("reader-filter-pill--active");
  });

  it('calls onTabChange("live") when Live is clicked', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();

    render(<SoftFilterBar counts={counts} onQueryChange={vi.fn()} onTabChange={onTabChange} query="" tab="all" />);

    await user.click(screen.getByRole("button", { name: "Live 3" }));

    expect(onTabChange).toHaveBeenCalledWith("live");
  });

  it("calls onQueryChange with incremental search values", async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();

    function ControlledSoftFilterBar() {
      const [query, setQuery] = useState("");

      return (
        <SoftFilterBar
          counts={counts}
          onQueryChange={(nextQuery) => {
            onQueryChange(nextQuery);
            setQuery(nextQuery);
          }}
          onTabChange={vi.fn()}
          query={query}
          tab="all"
        />
      );
    }

    render(<ControlledSoftFilterBar />);

    await user.type(screen.getByRole("searchbox", { name: "Search runs" }), "ai");

    expect(onQueryChange).toHaveBeenNthCalledWith(1, "a");
    expect(onQueryChange).toHaveBeenNthCalledWith(2, "ai");
    expect(onQueryChange).toHaveBeenLastCalledWith("ai");
  });

  it("exposes the searchbox by name and reader focus target", () => {
    render(<SoftFilterBar counts={counts} onQueryChange={vi.fn()} onTabChange={vi.fn()} query="" tab="all" />);

    const search = screen.getByRole("searchbox", { name: "Search runs" });

    expect(search).toHaveAttribute("data-reader-search");
    expect(search).toHaveAttribute("placeholder", "search project or topic");
  });
});
