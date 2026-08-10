import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionProjection } from "../attention-projection";
import type { SessionTile } from "../session-state";
import { AgentsDrawer, type AgentsDrawerProps } from "./AgentsDrawer";

const attentionItem: AttentionProjection = {
  id: "B:waiting",
  workspaceId: "B",
  workspaceLabel: "ClientApp",
  sessionId: "waiting",
  sessionTitle: "Review checkout",
  kind: "agent-waiting",
  section: "needs-you",
  blocksAgent: true,
  rank: 1,
  attentionAt: 100,
  reason: "Choose whether to keep the generated migration.",
  provenance: "inferred",
  action: { kind: "open-in-work" },
};

const sessions: SessionTile[] = [
  {
    id: "working",
    title: "Tighten project rail",
    workspaceId: "A",
    cwd: "/repo/alfred",
    source: "manual",
    stage: "live",
    runtimeStatus: "live",
    agentKind: "codex",
    activityEvents: [{
      id: "file",
      kind: "file",
      title: "Edited file",
      detail: "Updating ProjectNavigator.tsx",
      at: 200,
    }],
  },
  {
    id: "waiting",
    title: "Review checkout",
    workspaceId: "B",
    cwd: "/repo/client",
    source: "manual",
    stage: "live",
    runtimeStatus: "live",
    agentKind: "claude",
    activityEvents: [{ id: "approval", kind: "approval", title: "Waiting", detail: "Approve?", at: 100 }],
  },
];

const baseProps: AgentsDrawerProps = {
  activeSessions: [sessions[0]!],
  activeSessionId: "working",
  activeWorkspaceId: "A",
  attentionItems: [attentionItem],
  dismissalSuspended: false,
  open: true,
  returnFocusRef: { current: null },
  workspaces: [
    { id: "A", label: "Alfred" },
    { id: "B", label: "ClientApp" },
  ],
  onClose: vi.fn(),
  onOpenInbox: vi.fn(),
  onOpenSession: vi.fn(),
  onRunAttentionAction: vi.fn(),
};

function drawer(overrides: Partial<AgentsDrawerProps> = {}) {
  return <AgentsDrawer {...baseProps} {...overrides} />;
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("AgentsDrawer", () => {
  it("keeps the closed drawer hidden and inert, then focuses Close when opened", async () => {
    const view = render(drawer({ open: false }));
    const panel = screen.getByTestId("agents-drawer");
    expect(panel).toHaveAttribute("aria-hidden", "true");
    expect(panel).toHaveAttribute("inert");

    view.rerender(drawer({ open: true }));

    expect(panel).toHaveAttribute("aria-hidden", "false");
    await waitFor(() => expect(screen.getByRole("button", { name: "Close Agents" })).toHaveFocus());
  });

  it("separates decisions from in-progress work and routes exact records", async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    const onRunAttentionAction = vi.fn();
    render(drawer({ onOpenSession, onRunAttentionAction }));

    const panel = screen.getByRole("complementary", { name: "Agents" });
    const decisions = within(panel).getByRole("region", { name: "Needs a decision" });
    const inProgress = within(panel).getByRole("region", { name: "In progress" });
    expect(decisions).toHaveTextContent("Review checkout");
    expect(decisions).toHaveTextContent("Choose whether to keep the generated migration.");
    expect(inProgress).toHaveTextContent("Tighten project rail");
    expect(inProgress).not.toHaveTextContent("Review checkout");

    await user.click(within(decisions).getByRole("button", { name: "Open in Work Review checkout" }));
    expect(onRunAttentionAction).toHaveBeenCalledWith(attentionItem);

    await user.click(within(inProgress).getByRole("button", { name: "Open Tighten project rail in Alfred" }));
    expect(onOpenSession).toHaveBeenCalledWith("A", "working");
  });

  it("opens the full Inbox without presenting itself as a replacement", async () => {
    const onOpenInbox = vi.fn();
    render(drawer({ onOpenInbox }));

    expect(screen.getByText("Inbox", { selector: ".agents-drawer__footer-label" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open full Inbox queue" }));
    expect(onOpenInbox).toHaveBeenCalledOnce();
  });

  it("closes on Escape and restores the trigger only for an explicit drawer dismissal", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const returnFocusRef = { current: trigger };
    const onClose = vi.fn();
    const view = render(drawer({ returnFocusRef, onClose }));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    view.rerender(drawer({ open: false, returnFocusRef, onClose }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("leaves Escape to a higher overlay while dismissal is suspended", () => {
    const onClose = vi.fn();
    render(drawer({ dismissalSuspended: true, onClose }));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not steal focus when a higher overlay closes", () => {
    const view = render(drawer());
    const higherOverlayTrigger = document.createElement("button");
    document.body.append(higherOverlayTrigger);
    higherOverlayTrigger.focus();

    view.rerender(drawer({ dismissalSuspended: true }));
    view.rerender(drawer({ dismissalSuspended: false }));

    expect(higherOverlayTrigger).toHaveFocus();
  });

  it("restores the Agents trigger after launching staged work", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const launchItem: AttentionProjection = {
      ...attentionItem,
      id: "A:staged",
      workspaceId: "A",
      workspaceLabel: "Alfred",
      sessionId: "staged",
      sessionTitle: "Run checks",
      kind: "staged-launch",
      action: { kind: "launch" },
    };
    const view = render(drawer({ attentionItems: [launchItem], returnFocusRef: { current: trigger } }));

    await userEvent.click(screen.getByRole("button", { name: "Launch Run checks" }));
    view.rerender(drawer({ attentionItems: [launchItem], open: false, returnFocusRef: { current: trigger } }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("does not repeat an approval prompt after newer output resumes work", () => {
    const lastOutputAt = Date.now();
    render(drawer({
      activeSessions: [{
        ...sessions[0]!,
        lastOutputAt,
        activityEvents: [{
          id: "approval",
          kind: "approval",
          title: "Waiting",
          detail: "Allow edit?",
          at: lastOutputAt - 1,
        }],
      }],
    }));

    const inProgress = screen.getByRole("region", { name: "In progress" });
    expect(inProgress).toHaveTextContent("Working");
    expect(inProgress).not.toHaveTextContent("Allow edit?");
  });

  it("marks the selected agent by workspace and session identity", () => {
    render(drawer({
      activeSessions: [
        sessions[0]!,
        { ...sessions[0]!, workspaceId: "B", title: "Same id in ClientApp", agentKind: "claude" },
      ],
    }));

    expect(screen.getByRole("button", { name: "Open Tighten project rail in Alfred" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: "Open Same id in ClientApp in ClientApp" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
