import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExternalSessionSummary,
  SessionsApi,
  SessionsProjectInput,
  TranscriptBlock,
  TranscriptPage,
} from "../../shared/sessions-ipc";
import type { TerminalApi, TerminalSessionSnapshot } from "../../shared/terminal-ipc";
import type { SessionTile } from "../session-state";
import {
  createInitialSessionsViewState,
  type SessionsViewState,
} from "../sessions-view-state";
import { SessionsSurface, type SessionsSurfaceProps } from "./SessionsSurface";

const workspaces: SessionsProjectInput[] = [
  { id: "A", label: "Alfred", rootPath: "/Users/patryk/Desktop/Alfred" },
];

function managedSession(index: number, overrides: Partial<SessionTile> = {}): SessionTile {
  return {
    id: `managed-${index}`,
    runtimeId: `runtime-${index}`,
    title: index === 0 ? "Phase I navigator" : `Managed session ${index}`,
    workspaceId: "A",
    cwd: "/Users/patryk/Desktop/Alfred",
    source: "manual",
    stage: "live",
    runtimeStatus: "live",
    agentKind: "codex",
    command: "codex",
    createdAt: Date.now() - index,
    ...overrides,
  };
}

function externalSession(index: number, overrides: Partial<ExternalSessionSummary> = {}): ExternalSessionSummary {
  return {
    sessionKey: `external-codex:summary-${index}`,
    lineageKey: `external-codex:lineage-${index}`,
    contentSessionKey: `external-codex:content-${index}`,
    source: "external-codex",
    kind: "codex",
    title: `External session ${index}`,
    project: { id: "A", label: "Alfred" },
    locationLabel: "Alfred",
    updatedAt: Date.now() - index,
    lifecycle: "resumable",
    ...overrides,
  };
}

function transcriptPage(
  sessionKey: string,
  blocks: TranscriptBlock[],
  overrides: Partial<TranscriptPage> = {},
): TranscriptPage {
  return {
    sessionKey,
    blocks,
    nextCursor: null,
    revision: "revision-1",
    partial: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function createSessionsApi(): SessionsApi {
  return {
    listExternalSessions: vi.fn().mockResolvedValue({ sessions: [], nextCursor: null, total: 0 }),
    resolveExternalSession: vi.fn().mockResolvedValue({ kind: "none" }),
    readTranscriptPage: vi.fn().mockResolvedValue(transcriptPage("empty", [])),
    getDiagnostics: vi.fn().mockResolvedValue({
      cachedSessionCount: 0,
      decodedTranscriptBytes: 0,
      summaryCount: 0,
      summaryBytes: 0,
    }),
    clearCaches: vi.fn().mockResolvedValue(undefined),
  };
}

function createTerminalApi(snapshots: TerminalSessionSnapshot[] = []): Pick<TerminalApi, "snapshot"> {
  return {
    snapshot: vi.fn(async ({ id }) => snapshots.find((snapshot) => snapshot.id === id) ?? null),
  };
}

const baseProps = {
  externalSessionIndexingEnabled: true,
  externalSessions: [],
  externalSessionsError: null,
  loadingExternalSessions: false,
  sessions: [],
  sessionsApi: createSessionsApi(),
  terminalApi: createTerminalApi(),
  workspaces,
  onBackToWork: vi.fn(),
  onPrimaryAction: vi.fn(),
  onRefreshExternalSessions: vi.fn(),
} satisfies Omit<SessionsSurfaceProps, "state" | "onStateChange">;

function renderSurface(
  overrides: Partial<Omit<SessionsSurfaceProps, "state" | "onStateChange">> = {},
  initialState: SessionsViewState = createInitialSessionsViewState(),
) {
  const props = { ...baseProps, ...overrides };
  let currentState = initialState;

  function Harness() {
    const [state, setState] = useState(initialState);
    currentState = state;
    return <SessionsSurface {...props} state={state} onStateChange={setState} />;
  }

  const view = render(<Harness />);
  return { ...view, getState: () => currentState };
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: false,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SessionsSurface", () => {
  it("mounts the Sessions workspace with focused search and at most 80 options", () => {
    renderSurface({
      sessions: Array.from({ length: 90 }, (_, index) => managedSession(index)),
    });

    const surface = screen.getByRole("region", { name: "Sessions workspace" });
    const results = screen.getByRole("listbox", { name: "Session results" });
    expect(surface).toBeVisible();
    expect(results).toHaveClass("sessions-results");
    expect(screen.getAllByRole("option")[0]).toHaveClass("sessions-result");
    expect(surface.querySelector(".sessions-navigator__results")).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search sessions" })).toHaveFocus();
    expect(screen.getAllByRole("option")).toHaveLength(80);
    expect(screen.queryByText(/History|Observatory/)).not.toBeInTheDocument();
  });

  it("loads structured external messages only after selection and keeps explicit roles", async () => {
    const user = userEvent.setup();
    const sessionsApi = createSessionsApi();
    vi.mocked(sessionsApi.readTranscriptPage).mockResolvedValueOnce(transcriptPage(
      "external-codex:content-0",
      [
        { id: "user-1", kind: "message", role: "user", text: "Please ship Phase I" },
        { id: "assistant-1", kind: "message", role: "assistant", text: "Phase I is ready" },
      ],
    ));
    renderSurface({ externalSessions: [externalSession(0, { title: "Phase I review" })], sessionsApi });

    expect(sessionsApi.readTranscriptPage).not.toHaveBeenCalled();
    await user.click(screen.getByRole("option", { name: /Phase I review/ }));

    const article = await screen.findByRole("article", { name: /Phase I review/ });
    expect(article).toHaveTextContent("You");
    expect(article).toHaveTextContent("Assistant");
    expect(sessionsApi.readTranscriptPage).toHaveBeenCalledWith({ sessionKey: "external-codex:content-0" });
  });

  it("reads a managed and external merged session through one content key across pagination", async () => {
    const user = userEvent.setup();
    const sessionsApi = createSessionsApi();
    const terminalApi = createTerminalApi();
    vi.mocked(sessionsApi.readTranscriptPage)
      .mockResolvedValueOnce(transcriptPage(
        "external-codex:content-0",
        [{ id: "user-1", kind: "message", role: "user", text: "Merged question" }],
        { nextCursor: "cursor-1" },
      ))
      .mockResolvedValueOnce(transcriptPage(
        "external-codex:content-0",
        [{ id: "assistant-1", kind: "message", role: "assistant", text: "Merged answer" }],
      ));
    renderSurface({
      externalSessions: [externalSession(0)],
      sessions: [managedSession(0, {
        title: "Merged managed session",
        resumeTarget: {
          agentKind: "codex",
          sessionId: "content-0",
          source: "codex-session-index",
        },
      })],
      sessionsApi,
      terminalApi,
    });

    await user.click(screen.getByRole("option", { name: /Merged managed session/ }));
    const article = await screen.findByRole("article", { name: /Merged managed session/ });
    expect(article).toHaveTextContent("Merged question");
    expect(article).toHaveTextContent("You");
    expect(terminalApi.snapshot).not.toHaveBeenCalled();
    expect(sessionsApi.readTranscriptPage).toHaveBeenNthCalledWith(1, {
      sessionKey: "external-codex:content-0",
    });

    await user.click(screen.getByRole("button", { name: "Load more transcript" }));
    expect(await screen.findByText("Merged answer")).toBeInTheDocument();
    expect(sessionsApi.readTranscriptPage).toHaveBeenNthCalledWith(2, {
      sessionKey: "external-codex:content-0",
      cursor: "cursor-1",
    });
  });

  it("reads a live managed snapshot on selection as raw terminal blocks without invented roles", async () => {
    const user = userEvent.setup();
    const session = managedSession(4, { title: "Manual deploy", command: "zsh" });
    const terminalApi = createTerminalApi([{
      id: "runtime-4",
      clientId: session.id,
      title: session.title,
      source: "manual",
      workspaceId: "A",
      cwd: session.cwd,
      shell: "/bin/zsh",
      buffer: "You\nrelease output\n",
    }]);
    renderSurface({ sessions: [session], terminalApi });

    await user.click(screen.getByRole("option", { name: /Manual deploy/ }));
    const article = await screen.findByRole("article", { name: /Manual deploy/ });
    expect(article).toHaveTextContent("release output");
    expect(article).not.toHaveTextContent(/^You$/m);
    expect(within(article).getAllByTestId("transcript-block")).toHaveLength(2);
    expect(terminalApi.snapshot).toHaveBeenCalledOnce();
  });

  it("normalizes ordinary CRLF terminal output without marking it partial", async () => {
    const user = userEvent.setup();
    const session = managedSession(5, { title: "Windows line endings" });
    const terminalApi = createTerminalApi([{
      id: "runtime-5",
      clientId: session.id,
      title: session.title,
      source: "manual",
      workspaceId: "A",
      cwd: session.cwd,
      shell: "/bin/zsh",
      buffer: "first\r\nsecond\r\n",
    }]);
    renderSurface({ sessions: [session], terminalApi });

    await user.click(screen.getByRole("option", { name: /Windows line endings/ }));
    const article = await screen.findByRole("article", { name: /Windows line endings/ });
    expect(article).not.toHaveTextContent("Transcript is incomplete.");
  });

  it("keeps a managed transcript DOM to the newest 120 terminal blocks", async () => {
    const user = userEvent.setup();
    const session = managedSession(6, { title: "Bounded terminal" });
    const terminalApi = createTerminalApi([{
      id: "runtime-6",
      clientId: session.id,
      title: session.title,
      source: "manual",
      workspaceId: "A",
      cwd: session.cwd,
      shell: "/bin/zsh",
      buffer: Array.from({ length: 130 }, (_, index) => `line ${index}`).join("\n"),
    }]);
    renderSurface({ sessions: [session], terminalApi });

    await user.click(screen.getByRole("option", { name: /Bounded terminal/ }));
    const article = await screen.findByRole("article", { name: /Bounded terminal/ });
    expect(within(article).getAllByTestId("transcript-block")).toHaveLength(120);
    expect(article).not.toHaveTextContent("line 0\n");
    expect(article).toHaveTextContent("line 129");
    expect(article).toHaveTextContent("Transcript is incomplete.");
  });

  it("uses restored initialBuffer without requesting a live snapshot", async () => {
    const user = userEvent.setup();
    const terminalApi = createTerminalApi();
    const { runtimeId: _runtimeId, ...restoredSession } = managedSession(2, {
      runtimeStatus: "restored",
      initialBuffer: "restored line\n",
    });
    renderSurface({
      sessions: [restoredSession],
      terminalApi,
    });

    await user.click(within(screen.getByRole("listbox", { name: "Session results" })).getByRole("option"));
    expect(await screen.findByRole("article", { name: /Managed session 2/ })).toHaveTextContent("restored line");
    expect(terminalApi.snapshot).not.toHaveBeenCalled();
  });

  it("strips ANSI escape sequences from managed transcript buffers", async () => {
    const user = userEvent.setup();
    const terminalApi = createTerminalApi();
    const { runtimeId: _runtimeId, ...restoredSession } = managedSession(7, {
      runtimeStatus: "restored",
      title: "ANSI transcript",
      initialBuffer: "\u001b[1m\u001b[7m% \u001b[27m\u001b[1m\u001b[0mpnpm dev\nready\n",
    });

    renderSurface({
      sessions: [restoredSession],
      terminalApi,
    });

    await user.click(within(screen.getByRole("listbox", { name: "Session results" })).getByRole("option"));
    const article = await screen.findByRole("article", { name: /ANSI transcript/ });
    expect(article).toHaveTextContent("% pnpm dev");
    expect(article).toHaveTextContent("ready");
    expect(article).not.toHaveTextContent("[1m");
    expect(article).not.toHaveTextContent("[7m");
  });

  it("shows loading, no-result, disabled-indexing, and stale-refresh states without hiding managed sessions", async () => {
    const user = userEvent.setup();
    const view = renderSurface({ loadingExternalSessions: true });
    expect(screen.getByRole("status")).toHaveTextContent("Loading sessions");

    view.unmount();
    renderSurface({
      externalSessionIndexingEnabled: false,
      externalSessions: [],
      externalSessionsError: "Refresh failed.",
      sessions: [managedSession(1)],
    });
    expect(screen.getByText("External Codex indexing is off.")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Managed session 1/ })).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Search sessions" }), "no such session");
    expect(screen.getByText("No sessions found.")).toBeInTheDocument();

    cleanup();
    renderSurface({
      externalSessions: [externalSession(1, { title: "Retained external result" })],
      externalSessionsError: "Refresh failed.",
    });
    expect(screen.getByText("External sessions may be incomplete.")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Retained external result/ })).toBeInTheDocument();
  });

  it("drops retained external transcript pages when indexing is disabled without hiding a merged managed session", async () => {
    const session = managedSession(0, {
      title: "Managed privacy boundary",
      resumeTarget: {
        agentKind: "codex",
        sessionId: "content-0",
        source: "codex-session-index",
      },
    });
    const initialState: SessionsViewState = {
      ...createInitialSessionsViewState(),
      selectedSessionKey: "managed:managed-0",
      readerPages: [transcriptPage(
        "external-codex:content-0",
        [{ id: "private", kind: "message", role: "assistant", text: "Private external content" }],
      )],
    };
    const view = renderSurface({
      externalSessionIndexingEnabled: false,
      externalSessions: [],
      sessions: [session],
    }, initialState);

    await waitFor(() => expect(screen.queryByText("Private external content")).not.toBeInTheDocument());
    expect(screen.getByRole("option", { name: /Managed privacy boundary/ })).toBeInTheDocument();
    expect(view.getState().selectedSessionKey).toBe("managed:managed-0");
    expect(view.getState().readerPages).toEqual([]);
  });

  it("renders missing and malformed partial transcript states", async () => {
    const user = userEvent.setup();
    const sessionsApi = createSessionsApi();
    vi.mocked(sessionsApi.readTranscriptPage)
      .mockResolvedValueOnce(transcriptPage("external-codex:content-0", []))
      .mockResolvedValueOnce(transcriptPage(
        "external-codex:content-1",
        [{ id: "partial", kind: "notice", text: "Recovered fragment" }],
        { partial: true },
      ));
    renderSurface({ externalSessions: [externalSession(0), externalSession(1)], sessionsApi });

    await user.click(screen.getByRole("option", { name: /External session 0/ }));
    expect(await screen.findByText("Transcript is unavailable.")).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: /External session 1/ }));
    expect(await screen.findByText("Recovered fragment")).toBeInTheDocument();
    expect(screen.getByText("Transcript is incomplete.")).toBeInTheDocument();
  });

  it("ignores a stale transcript response after a newer selection", async () => {
    const user = userEvent.setup();
    const first = deferred<TranscriptPage>();
    const second = deferred<TranscriptPage>();
    const sessionsApi = createSessionsApi();
    vi.mocked(sessionsApi.readTranscriptPage)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderSurface({ externalSessions: [externalSession(0), externalSession(1)], sessionsApi });

    await user.click(screen.getByRole("option", { name: /External session 0/ }));
    await user.click(screen.getByRole("option", { name: /External session 1/ }));
    await act(async () => {
      second.resolve(transcriptPage("external-codex:content-1", [
        { id: "new", kind: "message", role: "assistant", text: "Newest selection" },
      ]));
    });
    expect(await screen.findByText("Newest selection")).toBeInTheDocument();

    await act(async () => {
      first.resolve(transcriptPage("external-codex:content-0", [
        { id: "stale", kind: "message", role: "assistant", text: "Stale selection" },
      ]));
    });
    expect(screen.queryByText("Stale selection")).not.toBeInTheDocument();
  });

  it("supports Cmd/Ctrl+F, list navigation, Enter, Escape, and an untrapped Tab path", async () => {
    const user = userEvent.setup();
    const onBackToWork = vi.fn();
    renderSurface({
      onBackToWork,
      sessions: [managedSession(0), managedSession(1), managedSession(2)],
      terminalApi: createTerminalApi(),
    });
    const search = screen.getByRole("searchbox", { name: "Search sessions" });
    const listbox = screen.getByRole("listbox", { name: "Session results" });
    const options = screen.getAllByRole("option");

    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(listbox).toHaveFocus();
    fireEvent.keyDown(listbox, { key: "End" });
    expect(listbox).toHaveAttribute("aria-activedescendant", options[2]?.id);
    fireEvent.keyDown(listbox, { key: "Home" });
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(listbox).toHaveAttribute("aria-activedescendant", options[1]?.id);
    fireEvent.keyDown(listbox, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("article", { name: /Managed session 1/ })).toBeInTheDocument());

    await user.tab();
    expect(screen.getByRole("button", { name: "Reveal in Work" })).toHaveFocus();

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(search).toHaveFocus();
    await user.type(search, "selected text");
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(search).toHaveFocus();
    expect(search).toHaveProperty("selectionStart", 0);

    fireEvent.keyDown(screen.getByRole("region", { name: "Sessions workspace" }), { key: "Escape" });
    expect(onBackToWork).toHaveBeenCalledOnce();
  });

  it("renders truthful lifecycle actions", async () => {
    const user = userEvent.setup();
    const onPrimaryAction = vi.fn();
    const live = managedSession(0, { title: "Live managed" });
    const restored = managedSession(1, {
      title: "Restored managed",
      runtimeStatus: "restored",
    });
    const mappedExternal = externalSession(0, { title: "Mapped external" });
    const untrustedExternal = externalSession(1, {
      title: "Untrusted external",
      project: { id: null, label: "External Codex" },
      lifecycle: "read-only",
    });
    const endedMapped = externalSession(2, {
      title: "Ended mapped external",
      lifecycle: "read-only",
    });
    renderSurface({
      sessions: [live, restored],
      externalSessions: [mappedExternal, untrustedExternal, endedMapped],
      onPrimaryAction,
    });

    await user.click(screen.getByRole("option", { name: /Live managed/ }));
    await user.click(screen.getByRole("button", { name: "Reveal in Work" }));
    expect(onPrimaryAction).toHaveBeenLastCalledWith(expect.objectContaining({
      action: { kind: "reveal", label: "Reveal in Work" },
      target: { workspaceId: "A", sessionId: "managed-0" },
    }));

    await user.click(screen.getByRole("option", { name: /Restored managed/ }));
    await user.click(screen.getByRole("button", { name: "Resume in Work" }));
    expect(onPrimaryAction).toHaveBeenLastCalledWith(expect.objectContaining({
      action: { kind: "recover", label: "Resume in Work" },
      target: { workspaceId: "A", sessionId: "managed-1" },
    }));

    await user.click(screen.getByRole("option", { name: /Mapped external/ }));
    await user.click(screen.getByRole("button", { name: "Resume in Work" }));
    expect(onPrimaryAction).toHaveBeenLastCalledWith(expect.objectContaining({
      action: { kind: "resume-external", label: "Resume in Work" },
      summary: expect.objectContaining({ sessionKey: mappedExternal.sessionKey }),
    }));

    await user.click(screen.getByRole("option", { name: /Untrusted external/ }));
    await user.click(screen.getByRole("button", { name: "Add Project…" }));
    expect(onPrimaryAction).toHaveBeenLastCalledWith(expect.objectContaining({
      action: { kind: "add-project", label: "Add Project…" },
      summary: expect.objectContaining({ sessionKey: untrustedExternal.sessionKey }),
    }));

    await user.click(screen.getByRole("option", { name: /Ended mapped external/ }));
    await user.click(screen.getByRole("button", { name: "Open Project" }));
    expect(onPrimaryAction).toHaveBeenLastCalledWith(expect.objectContaining({
      action: { kind: "open-project", label: "Open Project" },
      summary: expect.objectContaining({ sessionKey: endedMapped.sessionKey }),
    }));
  });

  it("dispatches the action captured for the selected summary even if the source object mutates later", async () => {
    const user = userEvent.setup();
    const onPrimaryAction = vi.fn();
    const untrusted = externalSession(7, {
      title: "Mutable external",
      project: { id: null, label: "External Codex" },
      lifecycle: "read-only",
    });
    renderSurface({ externalSessions: [untrusted], onPrimaryAction });

    await user.click(screen.getByRole("option", { name: /Mutable external/ }));
    const actionButton = screen.getByRole("button", { name: "Add Project…" });
    untrusted.project.id = "A";
    untrusted.lifecycle = "resumable";
    await user.click(actionButton);

    expect(onPrimaryAction).toHaveBeenCalledWith(expect.objectContaining({
      action: { kind: "add-project", label: "Add Project…" },
      summary: expect.objectContaining({
        sessionKey: untrusted.sessionKey,
        project: { id: null, label: "External Codex" },
        lifecycle: "read-only",
      }),
    }));
  });

  it("does not render an enabled lifecycle action without a handler", async () => {
    const user = userEvent.setup();
    renderSurface({ sessions: [managedSession(0)], onPrimaryAction: undefined });

    await user.click(screen.getByRole("option", { name: /Phase I navigator/ }));

    expect(screen.queryByRole("button", { name: "Reveal in Work" })).not.toBeInTheDocument();
  });

  it("restores scroll offsets and marks reduced motion without making transcript live", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const state: SessionsViewState = {
      ...createInitialSessionsViewState(),
      selectedSessionKey: "managed:managed-0",
      navigatorScrollTop: 70,
      readerScrollTop: 90,
      readerPages: [transcriptPage("managed:managed-0", [
        { id: "terminal", kind: "terminal", text: "saved output" },
      ])],
    };
    renderSurface({ sessions: [managedSession(0)] }, state);

    const surface = screen.getByRole("region", { name: "Sessions workspace" });
    expect(surface).toHaveClass("sessions-surface--reduced-motion");
    expect(screen.getByRole("listbox", { name: "Session results" })).toHaveProperty("scrollTop", 70);
    expect(surface.querySelector(".sessions-reader__scroll")).toHaveProperty("scrollTop", 90);
    expect(screen.getByRole("article", { name: /Phase I/ })).not.toHaveAttribute("aria-live");
  });
});
