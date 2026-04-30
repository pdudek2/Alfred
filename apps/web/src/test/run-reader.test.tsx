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
    expect(screen.getByText("Session opened")).toBeInTheDocument();
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
