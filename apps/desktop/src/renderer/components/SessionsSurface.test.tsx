import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRANSCRIPT_TEXT_LIMIT,
  type ExternalSessionSummary,
  type SessionsApi,
  type SessionsProjectInput,
  type TranscriptBlock,
  type TranscriptPage,
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
    releaseListSnapshot: vi.fn().mockResolvedValue(undefined),
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
  armedRecoverySessionIds: new Set<string>(),
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
  it("separates Projects, Conversations, and the Reader into complementary navigation levels", async () => {
    const user = userEvent.setup();
    const scopedWorkspaces: SessionsProjectInput[] = [
      ...workspaces,
      { id: "B", label: "ClientApp", rootPath: "/Users/patryk/Desktop/ClientApp" },
      { id: "FREE", label: "Free Chat", rootPath: "/Users/patryk/Documents/Codex" },
      { id: "EMPTY", label: "Workspace 99" },
    ];
    renderSurface({
      workspaces: scopedWorkspaces,
      sessions: [
        managedSession(0, { title: "Alfred architecture" }),
        managedSession(1, {
          title: "Client release",
          workspaceId: "B",
          cwd: "/Users/patryk/Desktop/ClientApp",
        }),
      ],
    });

    expect(screen.getByRole("navigation", { name: "Projects" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Free Chat0/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Free Chats0/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Workspace 99/ })).not.toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Conversation results" })).toBeVisible();
    expect(screen.getByRole("main", { name: "Session reader" })).toBeVisible();
    expect(screen.getAllByRole("option")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /ClientApp/ }));
    expect(screen.getByRole("option", { name: /Client release/ })).toBeVisible();
    expect(screen.queryByRole("option", { name: /Alfred architecture/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole("listbox", { name: "Conversation results" })).queryByRole("heading", { name: "ClientApp" })).not.toBeInTheDocument();
  });

  it("keeps the open reader stable while the adjacent project scope changes", async () => {
    const user = userEvent.setup();
    const scopedWorkspaces: SessionsProjectInput[] = [
      ...workspaces,
      { id: "B", label: "ClientApp", rootPath: "/Users/patryk/Desktop/ClientApp" },
    ];
    renderSurface({
      workspaces: scopedWorkspaces,
      sessions: [
        managedSession(0, { title: "Alfred architecture", initialBuffer: "Alfred evidence", runtimeStatus: "restored" }),
        managedSession(1, {
          title: "Client release",
          workspaceId: "B",
          cwd: "/Users/patryk/Desktop/ClientApp",
        }),
      ],
    });

    await user.click(screen.getByRole("option", { name: /Alfred architecture/ }));
    expect(await screen.findByRole("article", { name: /Alfred architecture/ })).toHaveTextContent("Alfred evidence");

    await user.click(screen.getByRole("button", { name: /ClientApp/ }));
    expect(screen.getByRole("option", { name: /Client release/ })).toBeVisible();
    expect(screen.getByRole("article", { name: /Alfred architecture/ })).toHaveTextContent("Alfred evidence");
  });

  it("keeps orphaned delegated runs out of conversations and behind one maintenance disclosure", () => {
    const orphan = externalSession(7, {
      lineageKey: "external-codex:missing-parent",
      parentContentSessionKey: "external-codex:missing-parent",
      title: "Internal delegated task",
    });
    renderSurface({ externalSessions: [orphan] });

    expect(screen.queryByRole("option", { name: /Internal delegated task/ })).not.toBeInTheDocument();
    const disclosure = screen.getByText("1 internal run hidden").closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(within(disclosure as HTMLElement).getByText(/could not be attached to a verified parent conversation/i)).toBeInTheDocument();
  });

  it("mounts the Sessions workspace with focused search and at most 80 options", () => {
    renderSurface({
      sessions: Array.from({ length: 90 }, (_, index) => managedSession(index)),
    });

    const surface = screen.getByRole("region", { name: "Sessions workspace" });
    const results = screen.getByRole("listbox", { name: "Conversation results" });
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

  it("keeps delegated work collapsed and reloads source evidence only when Raw transcript is requested", async () => {
    const user = userEvent.setup();
    const sessionsApi = createSessionsApi();
    vi.mocked(sessionsApi.readTranscriptPage)
      .mockResolvedValueOnce(transcriptPage("external-codex:content-0", [
        { id: "clean", kind: "message", role: "user", text: "Meaningful request" },
      ]))
      .mockResolvedValueOnce(transcriptPage("external-codex:content-0", [
        { id: "raw", kind: "message", role: "system", text: "Raw bootstrap context" },
      ]));
    renderSurface({
      externalSessions: [externalSession(0, { title: "Parent conversation", delegatedRunCount: 4 })],
      sessionsApi,
    });

    await user.click(screen.getByRole("option", { name: /Parent conversation/ }));
    expect(await screen.findByText("Meaningful request")).toBeInTheDocument();
    const delegated = screen.getByText(/Delegated work/).closest("details");
    expect(delegated).not.toHaveAttribute("open");

    await user.click(screen.getByRole("button", { name: "Raw transcript" }));
    expect(await screen.findByText("Raw bootstrap context")).toBeInTheDocument();
    expect(sessionsApi.readTranscriptPage).toHaveBeenNthCalledWith(2, {
      sessionKey: "external-codex:content-0",
      mode: "raw",
    });
  });

  it("reads a managed and external merged session through one content key while keeping the Codex title", async () => {
    const user = userEvent.setup();
    const sessionsApi = createSessionsApi();
    const terminalApi = createTerminalApi();
    const exactCodexTitle = "Dokończ  plan na branchu — dokładna nazwa Codexa";
    vi.mocked(sessionsApi.readTranscriptPage).mockResolvedValueOnce(transcriptPage(
      "external-codex:content-0",
      [{ id: "user-1", kind: "message", role: "user", text: "Merged question" }],
    ));
    renderSurface({
      externalSessions: [externalSession(0, { title: exactCodexTitle })],
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

    await user.click(screen.getByRole("option", { name: /Dokończ plan na branchu/ }));
    const article = await screen.findByRole("article", { name: /Dokończ plan na branchu/ });
    expect(article).toHaveTextContent("Merged question");
    expect(article).toHaveTextContent("You");
    expect(terminalApi.snapshot).not.toHaveBeenCalled();
    expect(sessionsApi.readTranscriptPage).toHaveBeenNthCalledWith(1, {
      sessionKey: "external-codex:content-0",
    });
  });

  it("keeps loaded raw transcript blocks visible when a later page fails and can restart reading", async () => {
    const user = userEvent.setup();
    const sessionsApi = createSessionsApi();
    vi.mocked(sessionsApi.readTranscriptPage)
      .mockResolvedValueOnce(transcriptPage(
        "external-codex:content-0",
        [{ id: "latest", kind: "message", role: "assistant", text: "Latest clean messages" }],
      ))
      .mockResolvedValueOnce(transcriptPage(
        "external-codex:content-0",
        [{ id: "first", kind: "message", role: "assistant", text: "Stable first page" }],
        { nextCursor: "stale-cursor" },
      ))
      .mockRejectedValueOnce(new Error("stale cursor"))
      .mockResolvedValueOnce(transcriptPage(
        "external-codex:content-0",
        [{ id: "fresh", kind: "message", role: "assistant", text: "Fresh transcript" }],
      ));
    renderSurface({ externalSessions: [externalSession(0)], sessionsApi });

    await user.click(screen.getByRole("option", { name: /External session 0/ }));
    expect(await screen.findByText("Latest clean messages")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Raw transcript" }));
    expect(await screen.findByText("Stable first page")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more transcript" }));

    expect(await screen.findByText("The next transcript page could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("Stable first page")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh transcript" }));
    expect(await screen.findByText("Fresh transcript")).toBeInTheDocument();
    expect(screen.queryByText("Stable first page")).not.toBeInTheDocument();
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

    await user.click(within(screen.getByRole("listbox", { name: "Conversation results" })).getByRole("option"));
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

    await user.click(within(screen.getByRole("listbox", { name: "Conversation results" })).getByRole("option"));
    const article = await screen.findByRole("article", { name: /ANSI transcript/ });
    expect(article).toHaveTextContent("% pnpm dev");
    expect(article).toHaveTextContent("ready");
    expect(article).not.toHaveTextContent("[1m");
    expect(article).not.toHaveTextContent("[7m");
  });

  it("strips a CSI sequence that crosses the managed transcript limit", async () => {
    const user = userEvent.setup();
    const longCsi = `\u001b[${"1;".repeat(140)}1m`;
    const { runtimeId: _runtimeId, ...restoredSession } = managedSession(8, {
      runtimeStatus: "restored",
      title: "Boundary ANSI transcript",
      initialBuffer: `${longCsi}${"x".repeat(TRANSCRIPT_TEXT_LIMIT - 20)}`,
    });

    renderSurface({ sessions: [restoredSession] });

    await user.click(within(screen.getByRole("listbox", { name: "Conversation results" })).getByRole("option"));
    const article = await screen.findByRole("article", { name: /Boundary ANSI transcript/ });
    const block = article.querySelector("[data-testid='transcript-block']");
    expect(block).toHaveTextContent("x".repeat(100));
    expect(block).not.toHaveTextContent("1;1;1");
  });

  it("bounds managed transcript text by UTF-8 bytes without splitting a code point", async () => {
    const user = userEvent.setup();
    const { runtimeId: _runtimeId, ...restoredSession } = managedSession(9, {
      runtimeStatus: "restored",
      title: "Unicode transcript",
      initialBuffer: "🙂".repeat(TRANSCRIPT_TEXT_LIMIT),
    });
    renderSurface({ sessions: [restoredSession] });

    await user.click(screen.getByRole("option", { name: /Unicode transcript/ }));
    const block = (await screen.findByRole("article", { name: /Unicode transcript/ }))
      .querySelector("[data-testid='transcript-block']");
    const renderedText = block?.textContent ?? "";
    const transcriptText = renderedText.endsWith("\n") ? renderedText.slice(0, -1) : renderedText;
    expect(new TextEncoder().encode(transcriptText).byteLength).toBeLessThanOrEqual(TRANSCRIPT_TEXT_LIMIT);
    expect(transcriptText).not.toContain("�");
  });

  it("shows loading, no-result, disabled-indexing, and stale-refresh states without hiding managed sessions", async () => {
    const user = userEvent.setup();
    const onOpenPrivacySettings = vi.fn();
    const view = renderSurface({ loadingExternalSessions: true });
    expect(screen.getByRole("status")).toHaveTextContent("Loading conversations");

    view.unmount();
    renderSurface({
      externalSessionIndexingEnabled: false,
      externalSessions: [],
      externalSessionsError: "Refresh failed.",
      sessions: [managedSession(1)],
      onOpenPrivacySettings,
    });
    expect(screen.getByText("External Codex indexing is off.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Local Data & Privacy" }));
    expect(onOpenPrivacySettings).toHaveBeenCalledOnce();
    expect(screen.getByRole("option", { name: /Managed session 1/ })).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Search sessions" }), "no such session");
    expect(screen.getByText("No conversations found.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("option", { name: /Managed session 1/ })).toBeInTheDocument();

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
    const view = renderSurface({
      onBackToWork,
      sessions: [managedSession(0), managedSession(1), managedSession(2)],
      terminalApi: createTerminalApi(),
    });
    const search = screen.getByRole("searchbox", { name: "Search sessions" });
    const listbox = screen.getByRole("listbox", { name: "Conversation results" });
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
    expect(view.getState().focusTarget).toBe("reader");

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(search).toHaveFocus();
    await user.type(search, "selected text");
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(search).toHaveFocus();
    expect(search).toHaveProperty("selectionStart", 0);

    fireEvent.keyDown(screen.getByRole("region", { name: "Sessions workspace" }), { key: "Escape" });
    expect(onBackToWork).toHaveBeenCalledOnce();
  });

  it("restores the previous Sessions focus target instead of always stealing focus to search", () => {
    const resultView = renderSurface(
      { sessions: [managedSession(0)] },
      { ...createInitialSessionsViewState(), focusTarget: "results" },
    );
    expect(screen.getByRole("listbox", { name: "Conversation results" })).toHaveFocus();

    resultView.unmount();
    renderSurface(
      { sessions: [managedSession(0)] },
      {
        ...createInitialSessionsViewState(),
        focusTarget: "reader",
        selectedSessionKey: "managed:managed-0",
        readerPages: [transcriptPage("managed:managed-0", [
          { id: "saved", kind: "terminal", text: "saved" },
        ])],
      },
    );
    expect(document.querySelector(".sessions-reader__scroll")).toHaveFocus();
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

  it("makes an unsafe recovery review and confirmation visible in Sessions", async () => {
    const user = userEvent.setup();
    const onPrimaryAction = vi.fn();
    const unsafeWithAgent = managedSession(10, {
      args: ["-rf", "dist"],
      command: "rm",
      cwd: "/Users/patryk/Desktop/Alfred",
      initialBuffer: "saved output\n",
      runtimeStatus: "restored",
      title: "Unsafe recovery",
    });
    const { agentKind: _agentKind, ...unsafe } = unsafeWithAgent;

    const initial = renderSurface({ sessions: [unsafe], onPrimaryAction });
    await user.click(screen.getByRole("option", { name: /Unsafe recovery/ }));
    expect(screen.queryByRole("region", { name: "Relaunch review" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review relaunch" }));
    expect(onPrimaryAction).toHaveBeenLastCalledWith(expect.objectContaining({
      action: { kind: "recover", label: "Review relaunch" },
      target: { workspaceId: "A", sessionId: "managed-10" },
    }));

    initial.unmount();
    renderSurface(
      {
        armedRecoverySessionIds: new Set(["managed-10"]),
        sessions: [unsafe],
        onPrimaryAction,
      },
      {
        ...createInitialSessionsViewState(),
        selectedSessionKey: "managed:managed-10",
        readerPages: [transcriptPage("managed:managed-10", [
          { id: "saved", kind: "terminal", text: "saved output" },
        ])],
      },
    );

    expect(screen.getByRole("button", { name: "Confirm relaunch" })).toBeInTheDocument();
    const review = screen.getByRole("region", { name: "Relaunch review" });
    expect(review).toHaveTextContent("rm -rf dist");
    expect(review).toHaveTextContent("/Users/patryk/Desktop/Alfred");
    expect(review).toHaveTextContent("rm -rf would be replayed");
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
    expect(screen.getByRole("listbox", { name: "Conversation results" })).toHaveProperty("scrollTop", 70);
    expect(surface.querySelector(".sessions-reader__scroll")).toHaveProperty("scrollTop", 90);
    expect(screen.getByRole("article", { name: /Phase I/ })).not.toHaveAttribute("aria-live");
  });
});
