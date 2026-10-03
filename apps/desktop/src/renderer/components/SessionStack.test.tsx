import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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
        workspaceLabel="Alfred"
        sessions={[session("pnpm dev", { shellBusy: true })]}
        onFocusSession={onFocusSession}
        onOpenAsleep={onOpenAsleep}
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
      <SessionStack asleepCount={0} workspaceLabel="Alfred" sessions={[]} onFocusSession={vi.fn()} onOpenAsleep={vi.fn()} />,
    );

    expect(screen.getByText("No other sessions in this project.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /asleep/ })).not.toBeInTheDocument();
  });
});

describe("stackPreviewLine", () => {
  it("uses the latest non-lifecycle activity", () => {
    expect(stackPreviewLine({
      activityEvents: [
        { id: "1", kind: "command", title: "Command", detail: "pnpm test", at: 1 },
        { id: "2", kind: "lifecycle", title: "Session attached", detail: "", at: 2 },
      ],
    })).toBe("pnpm test");
    expect(stackPreviewLine({})).toBeNull();
  });
});
