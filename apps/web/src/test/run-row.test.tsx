import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunRow } from "../components/run-row";
import { buildRunCardVM } from "../lib/run-view-model";
import { runFixture } from "./fixtures";

const NOW = new Date("2026-04-28T10:02:00.000Z");

function buildCard(overrides: Partial<typeof runFixture> = {}) {
  return buildRunCardVM(
    {
      ...runFixture,
      title: "review importer",
      ...overrides,
    },
    NOW,
  );
}

describe("RunRow", () => {
  afterEach(() => cleanup());

  it("renders project, intent, subtitle, duration, and state label", () => {
    const card = buildCard();

    render(<RunRow card={card} subtitle="codex-cli · updated now" selected={false} onSelect={vi.fn()} />);

    const row = screen.getByRole("button", { name: /Alfred.*review importer/i });

    expect(within(row).getByText("Alfred · review importer")).toBeInTheDocument();
    expect(within(row).getByText("codex-cli · updated now")).toBeInTheDocument();
    expect(within(row).getByText("open")).toHaveClass("reader-run-row__duration");
    expect(within(row).getByText("running")).toHaveClass("reader-run-row__state");
  });

  it("calls onSelect with the run id when clicked", async () => {
    const user = userEvent.setup();
    const card = buildCard({ id: "run-click-target" });
    const onSelect = vi.fn();

    render(<RunRow card={card} subtitle="codex-cli" selected={false} onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: /Alfred.*review importer/i }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("run-click-target");
  });

  it("marks the selected row", () => {
    const card = buildCard();

    render(<RunRow card={card} subtitle="codex-cli" selected={true} onSelect={vi.fn()} />);

    const row = screen.getByRole("button", { name: /Alfred.*review importer/i });

    expect(row).toHaveClass("reader-run-row--selected");
    expect(row).toHaveAttribute("aria-current", "true");
  });

  it("labels waiting runs as needs you", () => {
    const card = buildCard({ status: "waiting" });

    render(<RunRow card={card} subtitle="codex-cli" selected={false} onSelect={vi.fn()} />);

    const row = screen.getByRole("button", { name: /Alfred.*review importer/i });

    expect(row).toHaveClass("reader-state-waiting");
    expect(within(row).getByText("needs you")).toHaveClass("reader-run-row__state");
  });

  it("labels completed runs as ok", () => {
    const card = buildCard({
      status: "completed",
      completed_at: "2026-04-28T10:01:00.000Z",
    });

    render(<RunRow card={card} subtitle="codex-cli" selected={false} onSelect={vi.fn()} />);

    const row = screen.getByRole("button", { name: /Alfred.*review importer/i });

    expect(row).toHaveClass("reader-state-completed");
    expect(within(row).getByText("ok")).toHaveClass("reader-run-row__state");
  });

  it.each([
    ["failed", "failed", "reader-state-failed"],
    ["stale", "stale", "reader-state-stale"],
  ])("labels %s runs as %s", (status, label, stateClass) => {
    const card = buildCard({ status });

    render(<RunRow card={card} subtitle="codex-cli" selected={false} onSelect={vi.fn()} />);

    const row = screen.getByRole("button", { name: /Alfred.*review importer/i });

    expect(row).toHaveClass(stateClass);
    expect(within(row).getByText(label)).toHaveClass("reader-run-row__state");
  });

  it("labels cancelled runs explicitly", () => {
    const card = buildCard({ status: "cancelled" });

    render(<RunRow card={card} subtitle="codex-cli" selected={false} onSelect={vi.fn()} />);

    const row = screen.getByRole("button", { name: /Alfred.*review importer/i });

    expect(row).toHaveClass("reader-state-cancelled");
    expect(within(row).getByText("cancelled")).toHaveClass("reader-run-row__state");
  });
});
