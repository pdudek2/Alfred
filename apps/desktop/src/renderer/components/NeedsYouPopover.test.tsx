import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { AttentionProjection } from "../attention-projection";
import { NeedsYouPopover } from "./NeedsYouPopover";

afterEach(() => {
  cleanup();
});

function attention(overrides: Partial<AttentionProjection> & Pick<AttentionProjection, "id" | "sessionTitle">): AttentionProjection {
  return {
    workspaceId: "A",
    workspaceLabel: "Alfred",
    sessionId: overrides.id,
    kind: "agent-waiting",
    section: "needs-you",
    blocksAgent: true,
    rank: 1,
    attentionAt: 1,
    reason: "Wants to edit session-status.ts",
    provenance: "inferred",
    action: { kind: "open-in-work" },
    ...overrides,
  };
}

const approval = attention({ id: "A:approval", sessionTitle: "Refactor session status" });
const blocked = attention({
  id: "A:blocked",
  sessionTitle: "Reset the e2e database",
  kind: "blocked-safety",
  rank: 0,
  reason: "Launch blocked, runs outside the project",
  action: { kind: "review-edit" },
});

function Harness({ items, onRunAction = vi.fn() }: {
  items: AttentionProjection[];
  onRunAction?: (item: AttentionProjection) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button type="button">Terminal</button>
      <button ref={triggerRef} type="button" onClick={() => setOpen((value) => !value)}>Trigger</button>
      {open && (
        <NeedsYouPopover
          items={items}
          shortcutLabel="⌘J"
          triggerRef={triggerRef}
          onClose={() => setOpen(false)}
          onRunAction={(item) => {
            setOpen(false);
            onRunAction(item);
          }}
        />
      )}
    </>
  );
}

it("lists blocked sessions with project, reason and the matching action", async () => {
  const user = userEvent.setup();
  const onRunAction = vi.fn();
  render(<Harness items={[blocked, approval]} onRunAction={onRunAction} />);
  await user.click(screen.getByRole("button", { name: "Trigger" }));

  const dialog = screen.getByRole("dialog", { name: "Needs you" });
  expect(dialog).toHaveTextContent("⌘J");
  const list = screen.getByRole("list", { name: "Blocked on you" });
  expect(list).toHaveTextContent("Reset the e2e database");
  expect(list).toHaveTextContent("Launch blocked, runs outside the project");
  const edit = screen.getByRole("button", { name: "Edit Reset the e2e database in Alfred" });
  const open = screen.getByRole("button", { name: "Open Refactor session status in Alfred" });
  await waitFor(() => expect(edit).toHaveFocus());

  await user.keyboard("{ArrowDown}");
  expect(open).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(open).toHaveFocus();
  await user.keyboard("{Home}");
  expect(edit).toHaveFocus();
  await user.keyboard("{End}");
  await user.keyboard("{Enter}");

  expect(onRunAction).toHaveBeenCalledWith(approval);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Trigger" })).not.toHaveFocus();
});

it("closes on Escape and returns focus to where the user was", async () => {
  const user = userEvent.setup();
  render(<Harness items={[approval]} />);
  await user.click(screen.getByRole("button", { name: "Trigger" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /^Open Refactor/ })).toHaveFocus());

  await user.keyboard("{Escape}");

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Trigger" })).toHaveFocus());
});

it("shows an empty state when nothing waits", async () => {
  const user = userEvent.setup();
  render(<Harness items={[]} />);
  await user.click(screen.getByRole("button", { name: "Trigger" }));

  expect(screen.getByRole("status")).toHaveTextContent("Nothing needs you right now.");
  await waitFor(() => expect(screen.getByRole("dialog", { name: "Needs you" })).toHaveFocus());
});

it("closes without stealing focus when the user clicks elsewhere", async () => {
  const user = userEvent.setup();
  render(<Harness items={[approval]} />);
  await user.click(screen.getByRole("button", { name: "Trigger" }));

  await user.click(screen.getByRole("button", { name: "Terminal" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Terminal" })).toHaveFocus();
});

it("keeps focus inside when the focused row stops waiting", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<Harness items={[blocked, approval]} />);
  await user.click(screen.getByRole("button", { name: "Trigger" }));
  const open = screen.getByRole("button", { name: "Open Refactor session status in Alfred" });
  await waitFor(() => expect(screen.getByRole("button", { name: /^Edit Reset/ })).toHaveFocus());
  await user.keyboard("{ArrowDown}");
  expect(open).toHaveFocus();

  act(() => {
    rerender(<Harness items={[blocked]} />);
  });

  expect(screen.getByRole("button", { name: /^Edit Reset/ })).toHaveFocus();
});
