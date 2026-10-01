import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttentionProjection } from "../attention-projection";
import { ReviewSurface } from "./ReviewSurface";

const SAFETY = decision({
  id: "ALFRED:SAFETY",
  sessionId: "SAFETY",
  sessionTitle: "Safety cleanup",
  kind: "blocked-safety",
  rank: 0,
  reason: "Review destructive command",
  action: { kind: "review-edit" },
});

const WAITING = decision({
  id: "ALFRED:WAITING",
  sessionId: "WAITING",
  sessionTitle: "Waiting agent",
  kind: "agent-waiting",
  rank: 1,
  reason: "Allow edit in app.tsx?",
  provenance: "inferred",
  action: { kind: "open-in-work" },
});

const RUNTIME_BLOCKER = decision({
  id: "ALFRED:RUNTIME",
  sessionId: "RUNTIME",
  sessionTitle: "Claude authentication",
  kind: "runtime-blocker",
  rank: 0,
  reason: "Not logged in",
  action: { kind: "open-in-work" },
});

const STAGED = decision({
  id: "ALFRED:STAGED",
  sessionId: "STAGED",
  sessionTitle: "Run checks",
  kind: "staged-launch",
  rank: 2,
  reason: "pnpm test",
  command: "pnpm test",
  provenance: "structured",
  action: { kind: "launch" },
});

const DECISIONS = [SAFETY, WAITING, STAGED];

function decision(
  overrides: Partial<AttentionProjection> & Pick<AttentionProjection, "id" | "sessionId" | "sessionTitle" | "kind" | "rank" | "reason" | "action">,
): AttentionProjection {
  return {
    workspaceId: "ALFRED",
    workspaceLabel: "Alfred",
    section: "needs-you",
    blocksAgent: true,
    attentionAt: 1_000,
    provenance: "runtime",
    ...overrides,
  };
}

function renderSurface(attentionItems: AttentionProjection[] = DECISIONS) {
  const handlers = {
    onLaunch: vi.fn(),
    onOpenInWork: vi.fn(),
    onRecover: vi.fn(),
    onReviewEdit: vi.fn(),
    onBackToWork: vi.fn(),
  };
  const view = render(<ReviewSurface attentionItems={attentionItems} {...handlers} />);
  return {
    ...handlers,
    rerenderSurface: (nextItems: AttentionProjection[]) => {
      view.rerender(<ReviewSurface attentionItems={nextItems} {...handlers} />);
    },
  };
}

function selectButton(item: AttentionProjection): HTMLElement {
  return screen.getByTestId(`inbox-decision-select-${item.id}`);
}

function expandedItems(): HTMLElement[] {
  return screen.getAllByTestId(/inbox-decision-select-/).filter((item) => item.getAttribute("aria-expanded") === "true");
}

afterEach(() => {
  cleanup();
});

describe("ReviewSurface", () => {
  it("uses Inbox naming and flat section hierarchy", () => {
    renderSurface();
    const inbox = screen.getByRole("region", { name: "Inbox workspace" });

    expect(within(inbox).getByRole("heading", { name: "Needs you" })).toBeVisible();
    expect(within(inbox).getByText("3 decisions", { exact: true })).toBeVisible();
    expect(within(inbox).getByText("Highest impact first", { exact: true })).toBeVisible();
    expect(within(inbox).queryByText("Decision Inbox", { exact: true })).not.toBeInTheDocument();
    expect(within(inbox).queryByText("Needs You", { exact: true })).not.toBeInTheDocument();
  });

  it("renders the single global Inbox toolbar without duplicate navigation or status chrome", async () => {
    const user = userEvent.setup();
    const handlers = renderSurface();

    const surface = screen.getByRole("region", { name: "Inbox workspace" });
    expect(surface).toHaveClass("inbox-docket");
    expect(surface).toHaveAttribute("data-secondary-chrome-height", "52");
    expect(within(surface).getByRole("heading", { name: "Inbox" })).toBeVisible();
    expect(within(surface).getByText("All projects", { exact: true })).toBeVisible();
    expect(within(surface).getByText("3 need you", { exact: true })).toBeVisible();
    expect(within(surface).queryByRole("navigation", { name: "Primary surfaces" })).not.toBeInTheDocument();
    expect(surface.querySelector(".inbox-docket__statusbar")).not.toBeInTheDocument();
    expect(surface.querySelector(".review-surface")).not.toBeInTheDocument();
    expect(surface.querySelector(".inbox-section")).not.toBeInTheDocument();
    expect(surface.querySelector("[class*='avatar'], [class*='pill']")).not.toBeInTheDocument();

    await user.click(within(surface).getByRole("button", { name: "Back to Work" }));
    expect(handlers.onBackToWork).toHaveBeenCalledOnce();
  });

  it("keeps Enter on Back to Work from running the selected decision", async () => {
    const user = userEvent.setup();
    const handlers = renderSurface();

    screen.getByRole("button", { name: "Back to Work" }).focus();
    await user.keyboard("{Enter}");

    expect(handlers.onBackToWork).toHaveBeenCalledOnce();
    expect(handlers.onReviewEdit).not.toHaveBeenCalled();
    expect(handlers.onOpenInWork).not.toHaveBeenCalled();
    expect(handlers.onLaunch).not.toHaveBeenCalled();
    expect(handlers.onRecover).not.toHaveBeenCalled();
  });

  it("selects, expands, and focuses the first decision without running an action", () => {
    const handlers = renderSurface();

    expect(selectButton(SAFETY)).toHaveAttribute("aria-expanded", "true");
    expect(selectButton(SAFETY)).toHaveAttribute("aria-current", "true");
    expect(selectButton(SAFETY)).toHaveAttribute("tabindex", "0");
    expect(selectButton(WAITING)).toHaveAttribute("tabindex", "-1");
    expect(selectButton(SAFETY)).toHaveFocus();
    expect(expandedItems()).toEqual([selectButton(SAFETY)]);
    expect(handlers.onLaunch).not.toHaveBeenCalled();
    expect(handlers.onOpenInWork).not.toHaveBeenCalled();
    expect(handlers.onRecover).not.toHaveBeenCalled();
    expect(handlers.onReviewEdit).not.toHaveBeenCalled();
  });

  it("expands exactly one decision by click or Space", async () => {
    const user = userEvent.setup();
    renderSurface();

    await user.click(selectButton(WAITING));
    expect(expandedItems()).toEqual([selectButton(WAITING)]);
    expect(selectButton(WAITING)).toHaveFocus();

    selectButton(STAGED).focus();
    await user.keyboard(" ");
    expect(expandedItems()).toEqual([selectButton(STAGED)]);
    expect(selectButton(STAGED)).toHaveFocus();
  });

  it("moves selection, expansion, and focus together with ArrowUp, ArrowDown, Home, and End", async () => {
    const user = userEvent.setup();
    renderSurface();

    await user.keyboard("{ArrowDown}");
    expect(expandedItems()).toEqual([selectButton(WAITING)]);
    expect(selectButton(WAITING)).toHaveFocus();

    await user.keyboard("{End}");
    expect(expandedItems()).toEqual([selectButton(STAGED)]);
    expect(selectButton(STAGED)).toHaveFocus();

    await user.keyboard("{ArrowUp}{Home}");
    expect(expandedItems()).toEqual([selectButton(SAFETY)]);
    expect(selectButton(SAFETY)).toHaveFocus();
  });

  it("runs the selected waiting decision's primary action on Enter", async () => {
    const user = userEvent.setup();
    const handlers = renderSurface();

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(handlers.onOpenInWork).toHaveBeenCalledOnce();
    expect(handlers.onOpenInWork).toHaveBeenCalledWith("ALFRED", "WAITING");
    expect(handlers.onLaunch).not.toHaveBeenCalled();
    expect(handlers.onRecover).not.toHaveBeenCalled();
    expect(handlers.onReviewEdit).not.toHaveBeenCalled();
  });

  it("renders a runtime blocker with its reason and Open in Work action", async () => {
    const user = userEvent.setup();
    const handlers = renderSurface([RUNTIME_BLOCKER]);

    const item = screen.getByTestId("inbox-decision-ALFRED:RUNTIME");
    expect(item).toHaveTextContent("Runtime blocked");
    expect(item).toHaveTextContent("Not logged in");
    expect(item).toHaveTextContent("Needs you · runtime");

    await user.click(within(item).getByRole("button", { name: "Open in Work Claude authentication in Alfred" }));
    expect(handlers.onOpenInWork).toHaveBeenCalledWith("ALFRED", "RUNTIME");
  });

  it("routes staged actions through their canonical handler and leaves recovery to History", async () => {
    const user = userEvent.setup();
    const recovery = decision({
      id: "ALFRED:RECOVERY",
      sessionId: "RECOVERY",
      sessionTitle: "Saved Codex",
      kind: "recovery",
      section: "recovery",
      blocksAgent: false,
      rank: null,
      reason: "Asleep agent session can be resumed.",
      action: { kind: "resume" },
    });
    const handlers = renderSurface([STAGED, recovery]);

    await user.click(screen.getByRole("button", { name: "Launch Run checks in Alfred" }));
    expect(handlers.onLaunch).toHaveBeenCalledWith("STAGED");
    expect(handlers.onOpenInWork).not.toHaveBeenCalled();

    expect(screen.queryByText("Saved Codex")).not.toBeInTheDocument();
    expect(handlers.onRecover).not.toHaveBeenCalled();
    expect(handlers.onReviewEdit).not.toHaveBeenCalled();
  });

  it("offers a blocked decision only Review / Edit and routes only that action", async () => {
    const user = userEvent.setup();
    const handlers = renderSurface([SAFETY]);

    expect(screen.queryByText("Launch", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Run anyway", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("Discard", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Launch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Discard/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review / Edit Safety cleanup in Alfred" }));
    expect(handlers.onReviewEdit).toHaveBeenCalledWith("ALFRED", "SAFETY");
    expect(handlers.onLaunch).not.toHaveBeenCalled();
    expect(handlers.onOpenInWork).not.toHaveBeenCalled();
    expect(handlers.onRecover).not.toHaveBeenCalled();
  });

  it("reconciles a removed selection to the next decision and then the previous decision", async () => {
    const user = userEvent.setup();
    const handlers = renderSurface();

    await user.click(selectButton(WAITING));
    handlers.rerenderSurface([SAFETY, STAGED]);
    expect(expandedItems()).toEqual([selectButton(STAGED)]);
    expect(selectButton(STAGED)).toHaveFocus();

    handlers.rerenderSurface([SAFETY]);
    expect(expandedItems()).toEqual([selectButton(SAFETY)]);
    expect(selectButton(SAFETY)).toHaveFocus();
  });

  it("uses previous decision order when insert, reorder, and removal happen together", async () => {
    const user = userEvent.setup();
    const inserted = decision({
      ...SAFETY,
      id: "ALFRED:INSERTED",
      sessionId: "INSERTED",
      sessionTitle: "New blocker",
    });
    const handlers = renderSurface();

    await user.click(selectButton(WAITING));
    handlers.rerenderSurface([inserted, SAFETY, STAGED]);

    expect(expandedItems()).toEqual([selectButton(STAGED)]);
    expect(selectButton(STAGED)).toHaveFocus();
  });

  it("keeps focus on the primary action across a semantically unchanged rerender", () => {
    const handlers = renderSurface();
    const primaryAction = screen.getByRole("button", {
      name: "Review / Edit Safety cleanup in Alfred",
    });

    primaryAction.focus();
    expect(primaryAction).toHaveFocus();
    handlers.rerenderSurface([...DECISIONS]);

    expect(primaryAction).toHaveFocus();
  });

  it("restores focus to the Inbox surface when a selected decision moves to History", () => {
    const movedToRecovery = decision({
      ...SAFETY,
      kind: "recovery",
      section: "recovery",
      blocksAgent: false,
      rank: null,
      reason: "Asleep session can be resumed.",
      action: { kind: "resume" },
    });
    const handlers = renderSurface([SAFETY]);
    const primaryAction = screen.getByRole("button", {
      name: "Review / Edit Safety cleanup in Alfred",
    });

    primaryAction.focus();
    handlers.rerenderSurface([movedToRecovery]);

    expect(screen.getByRole("region", { name: "Inbox workspace" })).toHaveFocus();
  });

  it("keeps long reason and command values complete in details and accessible names", () => {
    const longReason = `Approval reason ${"very long ".repeat(30)}final reason`;
    const longCommand = `pnpm exec ${"--filter package-name ".repeat(24)}test`;
    const item = decision({
      ...STAGED,
      id: "ALFRED:LONG",
      sessionId: "LONG",
      sessionTitle: "Long command",
      reason: longReason,
      command: longCommand,
    });
    renderSurface([item]);

    const decisionItem = screen.getByTestId(`inbox-decision-${item.id}`);
    expect(within(decisionItem).getByText(longReason)).toBeInTheDocument();
    expect(within(decisionItem).getByText(longCommand)).toBeInTheDocument();
    expect(selectButton(item)).toHaveAccessibleDescription(expect.stringContaining(longReason));
    expect(selectButton(item)).toHaveAccessibleDescription(expect.stringContaining(longCommand));
  });

  it("omits age and received metadata when the attention timestamp is unknown", () => {
    const item = decision({
      ...STAGED,
      id: "ALFRED:UNKNOWN-TIME",
      sessionId: "UNKNOWN-TIME",
      sessionTitle: "Untimestamped draft command",
      attentionAt: 0,
    });
    renderSurface([item]);

    const decisionItem = screen.getByTestId(`inbox-decision-${item.id}`);
    expect(decisionItem.querySelector("time")).not.toBeInTheDocument();
    expect(within(decisionItem).queryByText("Received")).not.toBeInTheDocument();
    expect(within(decisionItem).queryByText("Now")).not.toBeInTheDocument();
  });

  it("renders a fresh attention timestamp as now without contradictory age copy", () => {
    const now = Date.now();
    const item = decision({
      ...STAGED,
      id: "ALFRED:FRESH",
      sessionId: "FRESH",
      sessionTitle: "Fresh draft command",
      attentionAt: now,
    });
    renderSurface([item]);

    const decisionItem = screen.getByTestId(`inbox-decision-${item.id}`);
    expect(within(decisionItem).getAllByText("now").length).toBeGreaterThan(0);
    expect(within(decisionItem).queryByText("now ago")).not.toBeInTheDocument();
    expect(decisionItem.querySelector("time")).toHaveAttribute("title", expect.stringMatching(/^Received /));
  });
});
