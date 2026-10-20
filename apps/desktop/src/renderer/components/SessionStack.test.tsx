import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionActivityEvent } from "../../shared/session-activity";
import { waitingSentence } from "../activity-presentation";
import type { SessionTile } from "../session-state";
import { SessionStack, stackPreviewLine } from "./SessionStack";

afterEach(() => {
  cleanup();
});

const now = Date.now();

function session(id: string, overrides: Partial<SessionTile> = {}): SessionTile {
  return {
    id,
    title: id,
    workspaceId: "A",
    cwd: "/repo",
    source: "manual",
    stage: "live",
    runtimeStatus: "live",
    ...overrides,
  };
}

describe("SessionStack", () => {
  it("groups sessions in contract order and previews only the busy and waiting ones", () => {
    render(
      <SessionStack
        asleepCount={0}
        now={now}
        workspaceLabel="Alfred"
        sessions={[
          session("idle shell", { shellBusy: false }),
          session("finished build", { runtimeStatus: "exited" }),
          session("dev server", {
            shellBusy: true,
            activityEvents: [{ id: "e1", kind: "output", title: "Progress reported", detail: "ready on 4310", at: now }],
          }),
          session("approval", {
            agentKind: "claude",
            agentSignal: { state: "needs-you", source: "hook", at: now },
            activityEvents: [{ id: "e2", kind: "approval", title: "Approval", detail: "Edit session-status.ts?", at: now }],
          }),
          session("turn done", { agentKind: "codex", agentSignal: { state: "your-turn", source: "osc9", at: now } }),
        ]}
        onFocusSession={vi.fn()}
        onOpenAsleep={vi.fn()}
        onPinSession={vi.fn()}
      />,
    );

    const stack = screen.getByRole("complementary", { name: "Other sessions in Alfred" });
    const groups = within(stack).getAllByRole("region");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "Needs you",
      "Your turn",
      "Running",
      "Idle",
      "Ended",
    ]);
    expect(within(groups[0]!).getByRole("button", { name: /approval/ })).toHaveTextContent("Edit session-status.ts?");
    expect(within(groups[2]!).getByRole("button", { name: /dev server/ })).toHaveTextContent("ready on 4310");
    expect(groups[3]!.querySelector(".session-stack-preview")).toBeNull();
    expect(groups[4]!.querySelector(".session-stack-preview")).toBeNull();
  });

  it("focuses a card on click and opens History from the asleep line", async () => {
    const user = userEvent.setup();
    const onFocusSession = vi.fn();
    const onOpenAsleep = vi.fn();
    render(
      <SessionStack
        asleepCount={3}
        now={now}
        workspaceLabel="Alfred"
        sessions={[session("pnpm dev", { shellBusy: true })]}
        onFocusSession={onFocusSession}
        onOpenAsleep={onOpenAsleep}
        onPinSession={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /pnpm dev/ }));
    await user.click(screen.getByRole("button", { name: "Browse 3 asleep sessions" }));

    expect(onFocusSession).toHaveBeenCalledWith("pnpm dev");
    expect(onOpenAsleep).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Browse 3 asleep sessions" })).toHaveTextContent("3 asleep");
  });

  it("says so when nothing else runs in the project", () => {
    render(
      <SessionStack asleepCount={0} now={now} workspaceLabel="Alfred" sessions={[]} onFocusSession={vi.fn()} onOpenAsleep={vi.fn()} onPinSession={vi.fn()} />,
    );

    expect(screen.getByText("No other sessions in this project.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /asleep/ })).not.toBeInTheDocument();
  });

  it("keeps the plan line under the groups and above the asleep line", () => {
    render(
      <SessionStack
        asleepCount={2}
        now={now}
        planLine={<div data-testid="plan-line" />}
        workspaceLabel="Alfred"
        sessions={[session("idle shell", { shellBusy: false })]}
        onFocusSession={vi.fn()}
        onOpenAsleep={vi.fn()}
        onPinSession={vi.fn()}
      />,
    );

    const stack = screen.getByRole("complementary", { name: "Other sessions in Alfred" });
    const planLine = within(stack).getByTestId("plan-line");
    const lastGroup = within(stack).getAllByRole("region").at(-1)!;
    const asleep = within(stack).getByRole("button", { name: "Browse 2 asleep sessions" });
    expect(lastGroup.compareDocumentPosition(planLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(planLine.compareDocumentPosition(asleep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("stackPreviewLine", () => {
  const working = { kind: "working", label: "working" } as const;
  const command: SessionActivityEvent = {
    id: "1", kind: "command", title: "Ran command", detail: "pnpm test", payload: { type: "command", command: "pnpm test" }, at: 1,
  };
  const attached: SessionActivityEvent = { id: "2", kind: "lifecycle", title: "Session attached", detail: "", at: 2 };

  it("says the latest activity other than Alfred's own as Details does", () => {
    expect(stackPreviewLine({ activityEvents: [command, attached] }, working)).toBe("Ran pnpm test");
    expect(stackPreviewLine({}, working)).toBeNull();
  });

  it("says what a waiting session asks as Needs you does, whatever came after it", () => {
    const prompt = "Approval requested: /bin/zsh -lc 'pnpm test --filter desktop'";
    const approval: SessionActivityEvent = {
      id: "3", kind: "approval", title: "Waiting for approval", detail: prompt, payload: { type: "approval", prompt }, at: 3,
    };
    const warning: SessionActivityEvent = { id: "4", kind: "warning", title: "Warning reported", detail: "npm warn deprecated", at: 4 };
    const line = stackPreviewLine({ activityEvents: [command, approval, warning] }, { kind: "needs-you", label: "needs you", reason: "approval" });
    expect(line).toBe(waitingSentence(approval));
    expect(line).toMatch(/^Wants to run /);
  });
});
