import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionActivityEvent } from "../../shared/session-activity";
import { waitingSentence } from "../../shared/activity-presentation";
import type { SessionTile } from "../session-state";
import { SessionTree, sessionPreviewLine } from "./SessionTree";

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

function renderTree(sessions: SessionTile[], overrides: Partial<Parameters<typeof SessionTree>[0]> = {}) {
  const props = {
    asleepCount: 0,
    collapsedParentIds: new Set<string>(),
    focusSessionId: null,
    now,
    pinnedSessionId: null,
    sessions,
    workspaceLabel: "Alfred",
    onFocusSession: vi.fn(),
    onNewWorker: vi.fn(),
    onOpenAsleep: vi.fn(),
    onPinSession: vi.fn(),
    onToggleWorkers: vi.fn(),
    ...overrides,
  };
  render(<SessionTree {...props} />);
  return props;
}

const rowTitles = (list: HTMLElement) =>
  within(list).getAllByRole("listitem").filter((item) => item.parentElement === list)
    .map((item) => item.querySelector(".session-tree-title")?.textContent);

describe("SessionTree", () => {
  it("orders rows in contract order and previews only the busy and waiting ones", () => {
    renderTree([
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
    ]);

    const list = screen.getByRole("list", { name: "Sessions in Alfred" });
    expect(rowTitles(list)).toEqual(["approval", "turn done", "dev server", "idle shell", "finished build"]);
    expect(screen.getByRole("button", { name: /^approval/ })).toHaveTextContent("Edit session-status.ts?");
    expect(screen.getByRole("button", { name: /^dev server/ })).toHaveTextContent("ready on 4310");
    expect(screen.getByRole("button", { name: /^idle shell/ }).querySelector(".session-tree-meta")).toBeNull();
    expect(screen.getByRole("button", { name: /^finished build/ }).querySelector(".session-tree-meta")).toBeNull();
  });

  it("leads with the question or the work mid-turn and with the changes once the turn is over", () => {
    const changeStats = { additions: 341, deletions: 33 };
    const activityEvents = [{ id: "e1", kind: "output", title: "Progress reported", detail: "reading the docs", at: now }] as const;
    const agent = (id: string, state: "needs-you" | "working" | "your-turn" | null, overrides: Partial<SessionTile> = {}) => session(id, {
      agentKind: "claude",
      activityEvents: [...activityEvents],
      lastActivityAt: now - 12 * 60_000,
      ...(state ? { agentSignal: { state, source: "hook", at: now } } : {}),
      ...overrides,
    });
    renderTree([
      agent("asking", "needs-you", { changeStats }),
      agent("busy", "working", { changeStats }),
      agent("finished", "your-turn", { changeStats }),
      agent("idle edits", null, { changeStats }),
      agent("idle reader", null),
      agent("silent", null, { activityEvents: [] }),
      session("idle shell", { shellBusy: false, changeStats }),
    ]);

    const meta = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) }).querySelector(".session-tree-meta");
    expect(meta("asking")).toHaveTextContent("reading the docs12m");
    expect(meta("busy")).toHaveTextContent("reading the docs12m");
    expect(meta("finished")).toHaveTextContent("+341−3312m");
    expect(meta("finished")).not.toHaveTextContent("reading the docs");
    expect(meta("idle edits")).toHaveTextContent("+341−3312m");
    expect(meta("idle reader")).toHaveTextContent("reading the docs12m");
    expect(meta("silent")).toBeNull();
    expect(meta("idle shell")).toBeNull();
  });

  it("shows a row's card after the pointer rests, the next row's at once, and one reached from the keyboard", () => {
    vi.useFakeTimers();
    try {
      const at = (minutes: number) => now - minutes * 60_000;
      renderTree([
        session("long", {
          title: "Refuse Apply when the worktree changed after review",
          agentKind: "claude",
          branchName: "alfred/refuse-apply",
          changeStats: { additions: 341, deletions: 33 },
          agentSignal: { state: "your-turn", source: "hook", at: now },
          activityEvents: [
            { id: "a1", kind: "command", title: "Ran command", detail: "pnpm lint", at: at(9) },
            { id: "a2", kind: "command", title: "Ran command", detail: "pnpm typecheck", at: at(4) },
            { id: "a3", kind: "file", title: "Edited", detail: "app.tsx", at: at(2), payload: { type: "file", operation: "edited", path: "src/app.tsx" } },
            { id: "a4", kind: "lifecycle", title: "Resuming session", detail: "Resumed", at: at(1) },
            { id: "a5", kind: "command", title: "Ran command", detail: "pnpm test", at: at(0) },
          ],
        }),
        session("zsh"),
      ]);
      const row = screen.getByRole("button", { name: /^Refuse Apply/ });
      const entry = row.parentElement!;

      fireEvent.mouseEnter(entry);
      expect(screen.queryByRole("tooltip")).toBeNull();
      act(() => { vi.advanceTimersByTime(500); });
      const card = screen.getByRole("tooltip");
      expect(card).toHaveTextContent("Refuse Apply when the worktree changed after review");
      expect(card).toHaveTextContent("Alfred");
      expect(card).toHaveTextContent("alfred/refuse-apply");
      expect(card).toHaveTextContent("Claude");
      expect(card).toHaveTextContent("+341−33in this conversation");
      expect([...within(card).getByRole("region", { name: "Latest" }).querySelectorAll("li > span:first-child")].map((item) => item.textContent))
        .toEqual(["Ran pnpm test", "Edited app.tsx", "Ran pnpm typecheck"]);
      expect(row.getAttribute("aria-describedby")).toContain(card.id);
      expect(row).not.toHaveAttribute("title");

      fireEvent.mouseLeave(entry);
      fireEvent.mouseEnter(screen.getByRole("button", { name: /^zsh/ }).parentElement!);
      expect(screen.getByRole("tooltip")).toHaveTextContent("Terminal");
      expect(screen.getByRole("tooltip")).not.toHaveTextContent("Latest");
      fireEvent.mouseLeave(screen.getByRole("button", { name: /^zsh/ }).parentElement!);
      act(() => { vi.advanceTimersByTime(100); });
      expect(screen.queryByRole("tooltip")).toBeNull();

      fireEvent.focus(row);
      expect(screen.getByRole("tooltip")).toHaveTextContent("Refuse Apply");
      fireEvent.keyDown(row, { key: "Escape" });
      expect(screen.queryByRole("tooltip")).toBeNull();
      fireEvent.blur(row);
      fireEvent.pointerDown(row);
      fireEvent.focus(row);
      expect(screen.queryByRole("tooltip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hangs workers under their parent and says whose worker each one is", () => {
    renderTree([
      session("Redesign History", { agentKind: "claude" }),
      session("Migrate store", { agentKind: "codex", parentSessionId: "Redesign History" }),
      session("pnpm dev", { shellBusy: true }),
      session("Write tests", { agentKind: "claude", parentSessionId: "Redesign History" }),
    ]);

    const list = screen.getByRole("list", { name: "Sessions in Alfred" });
    expect(rowTitles(list)).toEqual(["Redesign History", "pnpm dev"]);
    const workers = screen.getByRole("list", { name: "Workers of Redesign History" });
    expect(rowTitles(workers)).toEqual(["Migrate store", "Write tests"]);
    expect(within(workers).getByRole("button", { name: /^Migrate store/ })).toHaveAccessibleDescription("Worker of Redesign History");
    // A worker cannot have workers of its own; only top-level agents offer New worker.
    expect(screen.getByRole("button", { name: "New worker for Redesign History" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New worker for Migrate store" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New worker for pnpm dev" })).not.toBeInTheDocument();
  });

  it("puts a worker on top when its parent is gone, asleep or itself a worker", () => {
    renderTree([
      session("Orphan", { agentKind: "codex", parentSessionId: "closed-session" }),
      session("Asleep parent", { agentKind: "claude", runtimeStatus: "restored" }),
      session("Left behind", { agentKind: "codex", parentSessionId: "Asleep parent" }),
      session("Parent", { agentKind: "claude" }),
      session("Worker", { agentKind: "codex", parentSessionId: "Parent" }),
      session("Grandchild", { agentKind: "codex", parentSessionId: "Worker" }),
    ]);

    const list = screen.getByRole("list", { name: "Sessions in Alfred" });
    expect(rowTitles(list)).toEqual(["Orphan", "Left behind", "Parent", "Grandchild"]);
    expect(rowTitles(screen.getByRole("list", { name: "Workers of Parent" }))).toEqual(["Worker"]);
  });

  it("counts a collapsed parent's workers by state and toggles them", async () => {
    const user = userEvent.setup();
    const props = renderTree([
      session("Parent", { agentKind: "claude" }),
      session("Busy", { agentKind: "codex", parentSessionId: "Parent", agentSignal: { state: "working", source: "hook", at: now }, promptSubmitted: true }),
      session("Done", { agentKind: "claude", parentSessionId: "Parent", runtimeStatus: "exited" }),
    ], { collapsedParentIds: new Set(["Parent"]) });

    expect(screen.queryByRole("list", { name: "Workers of Parent" })).not.toBeInTheDocument();
    const parent = screen.getByRole("button", { name: /^Parent/ });
    expect(parent).toHaveTextContent("2 workers");
    expect(parent.querySelector(".session-tree-meta .status-working")).toHaveAttribute("title", "working");
    expect(parent.querySelector(".session-tree-meta .status-done")).toHaveAttribute("title", "done");

    const toggle = screen.getByRole("button", { name: "Show workers of Parent" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(props.onToggleWorkers).toHaveBeenCalledWith("Parent");
  });

  it("focuses, pins and starts a worker from a row, and opens the asleep list", async () => {
    const user = userEvent.setup();
    const props = renderTree([
      session("Focus", { agentKind: "claude" }),
      session("pnpm dev", { shellBusy: true }),
    ], { asleepCount: 3, focusSessionId: "Focus" });

    expect(screen.getByRole("button", { name: /^Focus/ })).toHaveAttribute("aria-current", "true");
    // The focus cannot be pinned under itself.
    expect(screen.getAllByRole("button", { name: "Pin under the focus" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /^pnpm dev/ }));
    await user.click(screen.getByRole("button", { name: "Pin under the focus" }));
    await user.click(screen.getByRole("button", { name: "New worker for Focus" }));
    await user.click(screen.getByRole("button", { name: "Browse 3 asleep sessions" }));

    expect(props.onFocusSession).toHaveBeenCalledWith("pnpm dev");
    expect(props.onPinSession).toHaveBeenCalledWith("pnpm dev");
    expect(props.onNewWorker).toHaveBeenCalledWith("Focus");
    expect(props.onOpenAsleep).toHaveBeenCalledOnce();
  });

  it("draws nothing for a project with no sessions and nothing asleep", () => {
    renderTree([]);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});

describe("sessionPreviewLine", () => {
  const working = { kind: "working", label: "working" } as const;
  const command: SessionActivityEvent = {
    id: "1", kind: "command", title: "Ran command", detail: "pnpm test", payload: { type: "command", command: "pnpm test" }, at: 1,
  };
  const attached: SessionActivityEvent = { id: "2", kind: "lifecycle", title: "Session attached", detail: "", at: 2 };

  it("says the latest activity other than Alfred's own as Details does", () => {
    expect(sessionPreviewLine({ activityEvents: [command, attached] }, working)).toBe("Ran pnpm test");
    expect(sessionPreviewLine({}, working)).toBeNull();
  });

  it("says where a running shell serves, over its latest activity", () => {
    const running = { kind: "running", label: "running" } as const;
    expect(sessionPreviewLine({ activityEvents: [command], servingUrl: "http://localhost:4310/" }, running))
      .toBe("Serving on port 4310");
    expect(sessionPreviewLine({ servingUrl: "http://localhost/" }, running)).toBe("Serving on localhost");
    expect(sessionPreviewLine({ activityEvents: [command], servingUrl: "http://localhost:4310/" }, working)).toBe("Ran pnpm test");
  });

  it("says what a waiting session asks as Needs you does, whatever came after it", () => {
    const prompt = "Approval requested: /bin/zsh -lc 'pnpm test --filter desktop'";
    const approval: SessionActivityEvent = {
      id: "3", kind: "approval", title: "Waiting for approval", detail: prompt, payload: { type: "approval", prompt }, at: 3,
    };
    const warning: SessionActivityEvent = { id: "4", kind: "warning", title: "Warning reported", detail: "npm warn deprecated", at: 4 };
    const line = sessionPreviewLine({ activityEvents: [command, approval, warning] }, { kind: "needs-you", label: "needs you", reason: "approval" });
    expect(line).toBe(waitingSentence(approval));
    expect(line).toMatch(/^Wants to run /);
  });
});
