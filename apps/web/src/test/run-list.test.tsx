import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunList } from "../components/run-list";
import { runFixture } from "./fixtures";

describe("RunList", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the project label when a padded source_run_id is the title fallback", () => {
    render(
      <RunList
        filtered={false}
        onClearFilters={vi.fn()}
        onSelectRun={vi.fn()}
        runs={[{ ...runFixture, title: null, source_run_id: " padded-id " }]}
        selectedRunId={null}
      />,
    );

    const row = screen.getByRole("button", { name: /codex-cli/i });
    const projectSlot = row.querySelector(".run-project");

    expect(projectSlot).toHaveTextContent("Alfred");
    expect(projectSlot).not.toHaveTextContent("padded-id");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("renders a sane primary label when source_run_id is %s at runtime", (label, sourceRunId) => {
    const runId = `run-with-${label}-source-run-id`;
    const runWithDirtySource = {
      ...runFixture,
      id: runId,
      title: null,
      source_run_id: sourceRunId,
    } as unknown as typeof runFixture;

    expect(() =>
      render(
        <RunList
          filtered={false}
          onClearFilters={vi.fn()}
          onSelectRun={vi.fn()}
          runs={[runWithDirtySource]}
          selectedRunId={null}
        />,
      ),
    ).not.toThrow();

    expect(screen.getByText(runId)).toBeInTheDocument();
  });
});
