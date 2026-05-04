import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Observatory } from "../components/observatory";
import { runFixture } from "./fixtures";

describe("Observatory", () => {
  afterEach(() => cleanup());

  const now = new Date("2026-04-29T12:00:00.000Z");
  const runs = [
    { ...runFixture, id: "r1", project_name: "alfred-runner", status: "running", updated_at: now.toISOString() },
    {
      ...runFixture,
      id: "r2",
      project_name: "alfred-runner",
      status: "completed",
      completed_at: "2026-04-29T11:30:00.000Z",
      updated_at: "2026-04-29T11:30:00.000Z",
    },
    { ...runFixture, id: "r3", project_name: "alfred-web", status: "waiting", updated_at: now.toISOString() },
  ];

  it("renders one node per run and one ellipse per project", () => {
    render(<Observatory runs={runs} now={now} onSelectRun={() => {}} />);

    expect(document.querySelectorAll("[data-node-run-id]").length).toBe(3);
    expect(document.querySelectorAll("[data-cluster-label]").length).toBe(2);
    expect(document.querySelector(".observatory-node-buttons")).toBeNull();
  });

  it("calls onSelectRun when a node is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Observatory runs={runs} now={now} onSelectRun={onSelect} />);

    const node = screen.getByRole("button", { name: "Open alfred-runner running run" });
    expect(node).toHaveAttribute("data-node-run-id", "r1");
    await user.click(node);

    expect(onSelect).toHaveBeenCalledWith("r1");
  });

  it("maps clicks on the SVG hit target to that exact run", () => {
    const onSelect = vi.fn();
    render(<Observatory runs={runs} now={now} onSelectRun={onSelect} />);

    const hitTarget = document.querySelector("[data-node-run-id='r3'].observatory-hit-target");
    expect(hitTarget).not.toBeNull();

    fireEvent.click(hitTarget as Element);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("r3");
  });

  it("uses the stable SVG hit target as the accessible node instead of the animated halo", () => {
    render(<Observatory runs={runs} now={now} onSelectRun={() => {}} />);

    const node = screen.getByRole("button", { name: "Open alfred-runner running run" });

    expect(node).toHaveClass("observatory-hit-target");
    expect(node).not.toHaveClass("observatory-halo");
    expect(document.querySelector(".observatory-node-buttons")).toBeNull();
  });

  it("exposes keyboard buttons for observatory nodes", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Observatory runs={runs} now={now} onSelectRun={onSelect} />);

    const button = screen.getByRole("button", { name: "Open alfred-runner running run" });
    button.focus();
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith("r1");
  });

  it("styles keyboard focus on the actual SVG hit target", () => {
    const css = readFileSync("src/styles/observatory.css", "utf8");

    expect(css).toContain(".observatory-hit-target:focus-visible");
    expect(css).not.toContain(".observatory-node:focus-visible");
  });

  it("uses the same quiet status as the reader for stale running sessions", () => {
    const staleRuns = [
      {
        ...runFixture,
        id: "stale-run",
        project_name: "old-agent",
        status: "running",
        updated_at: "2026-04-29T08:00:00.000Z",
      },
    ];

    render(<Observatory runs={staleRuns} now={now} onSelectRun={() => {}} />);

    expect(screen.getByRole("button", { name: "Open old-agent quiet run" })).toHaveAttribute(
      "data-node-run-id",
      "stale-run",
    );
    expect(screen.queryByRole("button", { name: "Open old-agent running run" })).not.toBeInTheDocument();
  });

  it("shows cancelled runs as cancelled instead of quiet", () => {
    const cancelledRuns = [
      {
        ...runFixture,
        id: "cancelled-run",
        lifecycle_status: "cancelled",
        project_name: "cancelled-agent",
        status: "cancelled",
        updated_at: now.toISOString(),
      },
    ];

    render(<Observatory runs={cancelledRuns} now={now} onSelectRun={() => {}} />);

    expect(screen.getByRole("button", { name: "Open cancelled-agent cancelled run" })).toHaveAttribute(
      "data-node-run-id",
      "cancelled-run",
    );
    expect(document.querySelector(".observatory-dot-cancelled")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Open cancelled-agent quiet run" })).not.toBeInTheDocument();
  });

  it("layers active nodes above quiet nodes so important signals receive the click", () => {
    const layeredRuns = [
      {
        ...runFixture,
        id: "quiet-run",
        project_name: "Alfred",
        status: "running",
        updated_at: "2026-04-29T08:00:00.000Z",
      },
      {
        ...runFixture,
        id: "active-run",
        project_name: "Alfred",
        status: "running",
        updated_at: now.toISOString(),
      },
    ];

    render(<Observatory runs={layeredRuns} now={now} onSelectRun={() => {}} />);

    const quietNode = screen.getByRole("button", { name: "Open Alfred quiet run" });
    const activeNode = screen.getByRole("button", { name: "Open Alfred running run" });
    expect(quietNode.compareDocumentPosition(activeNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("toggles time scope on pill click", async () => {
    const user = userEvent.setup();
    render(<Observatory runs={runs} now={now} onSelectRun={() => {}} />);

    expect(screen.getByRole("heading", { name: "Seven-day sky" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tonight's sky" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^7d$/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /^today$/ }));

    expect(screen.getByRole("button", { name: /^today$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Today's sky" })).toBeInTheDocument();
  });

  it("renders a signal legend for status colors", () => {
    render(<Observatory runs={runs} now={now} onSelectRun={() => {}} />);

    const legend = screen.getByLabelText("Signal legend");
    expect(legend).toHaveTextContent("live");
    expect(legend).toHaveTextContent("needs you");
    expect(legend).toHaveTextContent("failed");
    expect(legend).toHaveTextContent("quiet");
  });

  it("filters today by local calendar day instead of the last 24 hours", async () => {
    const user = userEvent.setup();
    const scopedRuns = [
      {
        ...runFixture,
        id: "today-run",
        project_name: "today-project",
        updated_at: "2026-04-29T07:00:00.000Z",
        started_at: null,
      },
      {
        ...runFixture,
        id: "yesterday-run",
        project_name: "yesterday-project",
        updated_at: "2026-04-28T20:30:00.000Z",
        started_at: null,
      },
    ];
    render(<Observatory runs={scopedRuns} now={now} onSelectRun={() => {}} />);

    await user.click(screen.getByRole("button", { name: /^today$/ }));

    expect(document.querySelector("[data-node-run-id='today-run']")).not.toBeNull();
    expect(document.querySelector("[data-node-run-id='yesterday-run']")).toBeNull();
  });
});
