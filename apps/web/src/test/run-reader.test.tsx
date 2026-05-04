import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { RunReader } from "../components/run-reader";
import type { RunDetail } from "../lib/api-client";
import { runDetailFixture } from "./fixtures";

const now = new Date("2026-04-28T10:01:30.000Z");

describe("RunReader", () => {
  afterEach(() => cleanup());

  it("renders title, story paragraph and activity list", () => {
    render(<RunReader detail={runDetailFixture} now={now} onClose={() => {}} />);

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/Alfred/);
    expect(screen.getByText(/Codex/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent phases", level: 3 })).toBeInTheDocument();
    expect(screen.getByText("Opened the session")).toBeInTheDocument();
    expect(screen.getByText("Ran commands")).toBeInTheDocument();
    expect(screen.getByText("Command started")).toBeInTheDocument();
  });

  it("calls onClose when escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<RunReader detail={runDetailFixture} now={now} onClose={onClose} />);

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("traps focus and restores the previously focused element on close", async () => {
    const user = userEvent.setup();
    render(<RunReaderHarness />);

    const before = screen.getByRole("button", { name: "Before" });
    const open = screen.getByRole("button", { name: "Open" });
    await user.click(before);
    await user.click(open);

    expect(screen.getByRole("button", { name: /Close run reader/i })).toHaveFocus();
    await user.tab({ shift: true });
    const activeElement =
      document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement
        ? document.activeElement
        : null;
    expect(screen.getByRole("dialog")).toContainElement(activeElement);
    expect(screen.getByText("‹ raw events")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(open).toHaveFocus();
  });

  it("expands an event payload when a story highlight with an event id is clicked", async () => {
    const user = userEvent.setup();
    const detail: RunDetail = {
      ...runDetailFixture,
      status: "completed",
      completed_at: "2026-04-28T10:02:00.000Z",
      events: [
        ...runDetailFixture.events,
        {
          id: "event-command",
          event_id: "event-command",
          source_event_id: "source-command",
          type: "tool.completed",
          status: "completed",
          occurred_at: "2026-04-28T10:01:30.000Z",
          payload: { command: "pnpm test", duration_ms: 125_000, tool_name: "exec_command" },
        },
      ],
    };

    render(<RunReader detail={detail} now={now} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "pnpm test" }));

    expect(screen.getByText(/Story highlight payload/i)).toBeInTheDocument();
    expect(screen.getAllByText(/"command": "pnpm test"/i).length).toBeGreaterThan(0);
  });

  it("renders recent phases first so long active runs start at the latest activity", () => {
    const detail: RunDetail = {
      ...runDetailFixture,
      events: [
        {
          id: "event-session",
          event_id: "event-session",
          source_event_id: "source-session",
          status: "running",
          occurred_at: "2026-04-28T10:00:00.000Z",
          type: "run.started",
          payload: { tool_name: "session" },
        },
        {
          id: "event-command",
          event_id: "event-command",
          source_event_id: "source-command",
          status: null,
          occurred_at: "2026-04-28T10:00:30.000Z",
          type: "tool.started",
          payload: { tool_name: "exec_command" },
        },
        {
          id: "event-failure",
          event_id: "event-failure",
          source_event_id: "source-failure",
          type: "tool.failed",
          status: "failed",
          occurred_at: "2026-04-28T10:01:00.000Z",
          payload: { tool_name: "exec_command", status: "failed" },
        },
      ],
    };

    render(<RunReader detail={detail} now={now} onClose={() => {}} />);

    const failure = screen.getByText("Hit a problem");
    const session = screen.getByText("Opened the session");
    expect(failure.compareDocumentPosition(session) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps raw payloads collapsed until raw events are requested", async () => {
    const user = userEvent.setup();
    render(<RunReader detail={runDetailFixture} now={now} onClose={() => {}} />);

    expect(screen.queryByText("tool_name: session")).not.toBeInTheDocument();

    await user.click(screen.getByText("‹ raw events"));

    expect(screen.getByText("tool_name: session")).toBeInTheDocument();
    expect(screen.getByText("tool_name: exec_command")).toBeInTheDocument();
  });

  it("keeps older phases collapsed so long runs open on recent activity", async () => {
    const user = userEvent.setup();
    const detail: RunDetail = {
      ...runDetailFixture,
      events: Array.from({ length: 10 }, (_, index) => ({
        id: `event-${index}`,
        event_id: `event-${index}`,
        source_event_id: `source-${index}`,
        status: null,
        occurred_at: `2026-04-28T10:${String(index).padStart(2, "0")}:00.000Z`,
        type: "tool.started",
        payload:
          index % 2 === 0
            ? { command: `echo command-${index}`, tool_name: "exec_command" }
            : { tool_name: "Read" },
      })),
    };

    render(<RunReader detail={detail} now={now} onClose={() => {}} />);

    expect(screen.getByText("Started echo command-8")).toBeInTheDocument();
    expect(screen.queryByText("Started echo command-0")).not.toBeInTheDocument();

    await user.click(screen.getByText("Show 2 older phases"));

    expect(screen.getByText("Started echo command-0")).toBeInTheDocument();
  });

  it("does not render every older phase for very long runs", async () => {
    const user = userEvent.setup();
    const detail: RunDetail = {
      ...runDetailFixture,
      events: Array.from({ length: 60 }, (_, index) => ({
        id: `event-${index}`,
        event_id: `event-${index}`,
        source_event_id: `source-${index}`,
        status: null,
        occurred_at: `2026-04-28T10:${String(index).padStart(2, "0")}:00.000Z`,
        type: "tool.started",
        payload:
          index % 2 === 0
            ? { command: `echo command-${index}`, tool_name: "exec_command" }
            : { tool_name: "Read" },
      })),
    };

    render(<RunReader detail={detail} now={now} onClose={() => {}} />);

    expect(screen.getByText("60 phases · 60 events")).toBeInTheDocument();
    expect(screen.getByText("Show 52 older phases")).toBeInTheDocument();
    expect(screen.getByText("Started echo command-58")).toBeInTheDocument();
    expect(screen.queryByText("Started echo command-0")).not.toBeInTheDocument();

    await user.click(screen.getByText("Show 52 older phases"));

    expect(screen.getByText("Started echo command-50")).toBeInTheDocument();
    expect(screen.getByText("Show all 52 older phases")).toBeInTheDocument();
    expect(screen.queryByText("Started echo command-0")).not.toBeInTheDocument();
  });
});

function RunReaderHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button">Before</button>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open ? <RunReader detail={runDetailFixture} now={now} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
