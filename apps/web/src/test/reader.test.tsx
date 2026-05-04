import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Reader } from "../components/reader";
import type { RunListItem } from "../lib/api-client";
import { completedRunFixture, runFixture } from "./fixtures";

const NOW = new Date("2026-04-28T11:30:00.000Z");

const liveRun: RunListItem = {
  ...runFixture,
  id: "run-live",
  project_name: "Alfred",
  project_key: "ALF",
  source_run_id: "codex-live",
  status: "running",
  title: "Live importer",
  started_at: "2026-04-28T11:00:00.000Z",
  completed_at: null,
  updated_at: "2026-04-28T11:20:00.000Z",
  created_at: "2026-04-28T11:00:00.000Z",
};

const needsRun: RunListItem = {
  ...runFixture,
  id: "run-needs",
  project_name: "Billing",
  project_key: "BILL",
  source_run_id: "codex-needs",
  status: "waiting",
  title: "Approve billing",
  started_at: "2026-04-28T11:05:00.000Z",
  completed_at: null,
  updated_at: "2026-04-28T11:25:00.000Z",
  created_at: "2026-04-28T11:05:00.000Z",
};

const doneRun: RunListItem = {
  ...completedRunFixture,
  id: "run-done",
  project_name: "Docs",
  project_key: "DOCS",
  source_run_id: "codex-done",
  status: "completed",
  title: "Publish notes",
  started_at: "2026-04-28T09:00:00.000Z",
  completed_at: "2026-04-28T09:30:00.000Z",
  updated_at: "2026-04-28T09:30:00.000Z",
  created_at: "2026-04-28T09:00:00.000Z",
};

const failedRun: RunListItem = {
  ...runFixture,
  id: "run-failed",
  project_name: "Deploy",
  project_key: "DEPLOY",
  source_run_id: "codex-failed",
  status: "failed",
  title: "Broken release",
  started_at: "2026-04-28T10:00:00.000Z",
  completed_at: "2026-04-28T10:10:00.000Z",
  updated_at: "2026-04-28T10:10:00.000Z",
  created_at: "2026-04-28T10:00:00.000Z",
};

const runs = [doneRun, liveRun, needsRun, failedRun];

function ControlledReader({
  initialSelectedRunId = null,
  loading = false,
  onSelectRun = vi.fn(),
  testRuns = runs,
}: {
  initialSelectedRunId?: string | null;
  loading?: boolean;
  onSelectRun?: (runId: string | null) => void;
  testRuns?: RunListItem[];
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialSelectedRunId);

  return (
    <Reader
      error={null}
      loading={loading}
      now={NOW}
      onSelectRun={(runId) => {
        onSelectRun(runId);
        setSelectedRunId(runId);
      }}
      runs={testRuns}
      selectedRunId={selectedRunId}
    />
  );
}

describe("Reader", () => {
  afterEach(() => cleanup());

  it("renders briefing, filters, and grouped feed rows from fixtures", () => {
    render(<ControlledReader initialSelectedRunId="run-needs" />);

    expect(document.querySelector(".reader-briefing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All 4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Live 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Needs you 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Problems 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done 1" })).toBeInTheDocument();

    const feed = screen.getByRole("region", { name: "Run feed" });

    expect(within(feed).getByRole("heading", { name: "Needs you" })).toBeInTheDocument();
    expect(within(feed).getByRole("heading", { name: "Running" })).toBeInTheDocument();
    expect(within(feed).getByRole("heading", { name: "Problems" })).toBeInTheDocument();
    expect(within(feed).getByRole("heading", { name: "Done" })).toBeInTheDocument();
    expect(within(feed).getByRole("button", { name: /Billing.*Approve billing/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(within(feed).getByRole("button", { name: /Alfred.*Live importer/i })).toBeInTheDocument();
    expect(within(feed).getByRole("button", { name: /Deploy.*Broken release/i })).toBeInTheDocument();
    expect(within(feed).getByRole("button", { name: /Docs.*Publish notes/i })).toBeInTheDocument();
  });

  it("focuses search with slash when focus is not inside an editable field", async () => {
    const user = userEvent.setup();
    render(<ControlledReader />);

    await user.keyboard("/");

    expect(screen.getByRole("searchbox", { name: "Search runs" })).toHaveFocus();
  });

  it("focuses search with mod+k when focus is not inside an editable field", async () => {
    const user = userEvent.setup();
    render(<ControlledReader />);

    await user.keyboard("{Meta>}k{/Meta}");

    expect(screen.getByRole("searchbox", { name: "Search runs" })).toHaveFocus();
  });

  it("does not swallow slash typed in search", async () => {
    const user = userEvent.setup();
    render(<ControlledReader />);

    const search = screen.getByRole("searchbox", { name: "Search runs" });
    await user.type(search, "/");

    expect(search).toHaveValue("/");
  });

  it("moves selection with ArrowDown and ArrowUp inside the feed", async () => {
    const user = userEvent.setup();
    render(<ControlledReader initialSelectedRunId="run-needs" />);

    const feed = screen.getByRole("region", { name: "Run feed" });
    const needsRow = within(feed).getByRole("button", { name: /Billing.*Approve billing/i });
    needsRow.focus();

    await user.keyboard("[ArrowDown]");

    expect(within(feed).getByRole("button", { name: /Alfred.*Live importer/i })).toHaveAttribute(
      "aria-current",
      "true",
    );

    await user.keyboard("[ArrowUp]");

    expect(within(feed).getByRole("button", { name: /Billing.*Approve billing/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("selects the first row with an arrow key when nothing is selected", async () => {
    const user = userEvent.setup();
    render(<ControlledReader />);

    const feed = screen.getByRole("region", { name: "Run feed" });
    feed.focus();

    await user.keyboard("[ArrowDown]");

    expect(within(feed).getByRole("button", { name: /Billing.*Approve billing/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("filters rows through search", async () => {
    const user = userEvent.setup();
    render(<ControlledReader />);

    await user.type(screen.getByRole("searchbox", { name: "Search runs" }), "billing");

    const feed = screen.getByRole("region", { name: "Run feed" });

    expect(within(feed).getByRole("button", { name: /Billing.*Approve billing/i })).toBeInTheDocument();
    expect(within(feed).queryByRole("button", { name: /Alfred.*Live importer/i })).not.toBeInTheDocument();
    expect(within(feed).queryByRole("button", { name: /Docs.*Publish notes/i })).not.toBeInTheDocument();
  });

  it("calls selection when a row is clicked", async () => {
    const user = userEvent.setup();
    const onSelectRun = vi.fn();
    render(<ControlledReader onSelectRun={onSelectRun} />);

    await user.click(screen.getByRole("button", { name: /Docs.*Publish notes/i }));

    expect(onSelectRun).toHaveBeenCalledWith("run-done");
  });

  it("dims the feed when a run is selected", () => {
    render(<ControlledReader initialSelectedRunId="run-needs" />);

    expect(screen.getByRole("region", { name: "Run feed" })).toHaveClass("reader-feed-dimmed");
  });

  it("shows an empty message when no agent has reported", () => {
    render(<ControlledReader testRuns={[]} />);

    expect(screen.getByText("No agent has reported in yet.")).toHaveClass("reader-empty-note");
  });

  it("keeps the empty feed quiet while the first run list is loading", () => {
    render(<ControlledReader loading testRuns={[]} />);

    expect(screen.getByRole("region", { name: "Run feed" })).toBeInTheDocument();
    expect(screen.queryByText("Quiet here. No agent has reported in yet.")).not.toBeInTheDocument();
    expect(screen.queryByText("No agent has reported in yet.")).not.toBeInTheDocument();
    expect(screen.queryByText("No runs match this view.")).not.toBeInTheDocument();
  });

  it("shows the API error voice when error is provided", () => {
    render(
      <Reader
        error={new Error("boom")}
        now={NOW}
        onSelectRun={() => {}}
        runs={[]}
        selectedRunId={null}
      />,
    );

    expect(screen.getByText(/I can't reach the runner/i)).toBeInTheDocument();
  });

  it("shows a filtered empty message when no runs match the current view", async () => {
    const user = userEvent.setup();
    render(<ControlledReader />);

    await user.type(screen.getByRole("searchbox", { name: "Search runs" }), "not-here");

    expect(screen.getByText("No runs match this view.")).toHaveClass("reader-empty-note");
  });
});
