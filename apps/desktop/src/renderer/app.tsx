import { Plus, X } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDesktopAlfredApi, getDesktopTerminalApi } from "./desktop-api";
import { ComposerBar } from "./composer";
import { StagedTilePreview } from "./staged-tile";
import { errored, idle, isThinking, thinking, type AlfredStatus, type SquadPlan } from "./alfred-state";
import {
  addManualSession,
  addStagedSessions,
  approveAllStaged,
  approveStaged,
  closeSession,
  createInitialSessions,
  rejectAllStaged,
  rejectStaged,
  type SessionTile,
} from "./session-state";
import type { TerminalSessionId } from "../shared/terminal-ipc";
import "@xterm/xterm/css/xterm.css";

type WorkspaceId = "A" | "UI" | "API" | "DOC";

const workspaceLabels: Record<WorkspaceId, string> = {
  A: "Alfred",
  API: "API",
  DOC: "Docs",
  UI: "UI",
};

export function App() {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>("A");
  const [terminalSessions, setTerminalSessions] = useState<SessionTile[]>(() => createInitialSessions(""));
  const [alfredStatus, setAlfredStatus] = useState<AlfredStatus>(idle());
  const [pendingPlan, setPendingPlan] = useState<SquadPlan | null>(null);
  const [composerValue, setComposerValue] = useState<string>("");
  const shortcutModifier = navigator.platform.includes("Mac") ? "Cmd" : "Ctrl";

  const handleAddManualSession = useCallback(() => {
    setTerminalSessions((sessions) => addManualSession(sessions, ""));
  }, []);

  const handleCloseSession = (sessionId: string) => {
    setTerminalSessions((sessions) => closeSession(sessions, sessionId));
  };

  const handleSubmitPrompt = useCallback(async () => {
    const prompt = composerValue.trim();
    if (!prompt) return;
    const alfredApi = getDesktopAlfredApi();
    if (!alfredApi) {
      setAlfredStatus(errored({ code: "network", message: "Alfred runtime is unavailable. Open the desktop app." }));
      return;
    }
    setAlfredStatus(thinking());
    setComposerValue("");
    const response = await alfredApi.requestPlan({ prompt });
    if (!response.ok) {
      setAlfredStatus(errored(response.error));
      return;
    }
    setAlfredStatus(idle());
    setTerminalSessions((sessions) => {
      const before = sessions;
      const after = addStagedSessions(before, response.plan.sessions, "");
      const newIds = after.slice(before.length).map((s) => s.id);
      setPendingPlan({
        id: crypto.randomUUID(),
        ...(response.plan.name === undefined ? {} : { name: response.plan.name }),
        prompt,
        sessionIds: newIds,
      });
      return after;
    });
  }, [composerValue]);

  const handleApproveTile = useCallback((tileId: string) => {
    setTerminalSessions((sessions) => approveStaged(sessions, tileId));
    setPendingPlan((plan) => {
      if (!plan) return plan;
      const remaining = plan.sessionIds.filter((id) => id !== tileId);
      return remaining.length === 0 ? null : { ...plan, sessionIds: remaining };
    });
  }, []);

  const handleRejectTile = useCallback((tileId: string) => {
    setTerminalSessions((sessions) => rejectStaged(sessions, tileId));
    setPendingPlan((plan) => {
      if (!plan) return plan;
      const remaining = plan.sessionIds.filter((id) => id !== tileId);
      return remaining.length === 0 ? null : { ...plan, sessionIds: remaining };
    });
  }, []);

  const handleApproveAll = useCallback(() => {
    setTerminalSessions((sessions) => approveAllStaged(sessions));
    setPendingPlan(null);
  }, []);

  const handleRejectAll = useCallback(() => {
    setTerminalSessions((sessions) => rejectAllStaged(sessions));
    setPendingPlan(null);
  }, []);

  const handleDismissError = useCallback(() => {
    setAlfredStatus(idle());
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "t") {
        event.preventDefault();
        handleAddManualSession();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleAddManualSession]);

  return (
    <main className="agent-space-shell">
      <section
        className={`desktop-frame ${shortcutModifier === "Cmd" ? "mac-frame" : ""}`}
        aria-label="Alfred Agent Space desktop shell"
      >
        <div className="mission-bar">
          <div className="mission-name">
            <div className="alfred-mark">A</div>
            <div>
              <strong>{workspaceLabels[activeWorkspace]} workspace</strong>
              <span>manual mode · local runtime</span>
            </div>
          </div>
          <div className="mission-actions" aria-label="terminal actions">
            <button
              className="new-terminal-button"
              type="button"
              aria-label="New terminal"
              onClick={handleAddManualSession}
              title="New terminal"
            >
              <Plus size={17} />
              <span>New terminal</span>
            </button>
          </div>
        </div>

        <div className="workspace-layout">
          <WorkspaceRail activeWorkspace={activeWorkspace} onSelectWorkspace={setActiveWorkspace} />
          <TerminalGrid
            sessions={terminalSessions}
            shortcutModifier={shortcutModifier}
            onCloseSession={handleCloseSession}
            onApproveTile={handleApproveTile}
            onRejectTile={handleRejectTile}
          />
          <AlfredDock
            status={alfredStatus}
            pendingPlan={pendingPlan}
            stagedCount={terminalSessions.filter((s) => s.stage === "staged").length}
            liveAlfredCount={terminalSessions.filter((s) => s.stage === "live" && s.source === "alfred").length}
            onApproveAll={handleApproveAll}
            onRejectAll={handleRejectAll}
            onDismissError={handleDismissError}
          />
        </div>
        <ComposerBar
          value={composerValue}
          thinking={isThinking(alfredStatus)}
          onChange={setComposerValue}
          onSubmit={handleSubmitPrompt}
        />
      </section>
    </main>
  );
}

function WorkspaceRail({
  activeWorkspace,
  onSelectWorkspace,
}: {
  activeWorkspace: WorkspaceId;
  onSelectWorkspace: (workspace: WorkspaceId) => void;
}) {
  const workspaces: WorkspaceId[] = ["A", "UI", "API", "DOC"];

  return (
    <nav className="workspace-rail" aria-label="workspaces">
      {workspaces.map((workspace) => (
        <button
          className={`workspace-button ${activeWorkspace === workspace ? "active" : ""}`}
          type="button"
          aria-label={`${workspaceLabels[workspace]} workspace`}
          aria-pressed={activeWorkspace === workspace}
          key={workspace}
          onClick={() => onSelectWorkspace(workspace)}
        >
          {workspace}
        </button>
      ))}
      <div className="workspace-spacer" />
      <button className="workspace-button" type="button" aria-label="Add workspace" disabled>
        +
      </button>
    </nav>
  );
}

function AlfredDock({
  status,
  pendingPlan,
  stagedCount,
  liveAlfredCount,
  onApproveAll,
  onRejectAll,
  onDismissError,
}: {
  status: AlfredStatus;
  pendingPlan: SquadPlan | null;
  stagedCount: number;
  liveAlfredCount: number;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onDismissError: () => void;
}) {
  return (
    <aside className="alfred-dock" aria-label="Alfred status">
      <div className="alfred-dock-header">
        <div className="alfred-dock-mark">A</div>
        <div>
          <strong>Alfred</strong>
          <span>{status.kind === "thinking" ? "thinking" : status.kind === "error" ? "error" : "quiet"}</span>
        </div>
      </div>

      {status.kind === "error" ? (
        <div className="alfred-dock-error" role="alert">
          <div>{status.error.message}</div>
          <button type="button" className="dismiss" onClick={onDismissError} aria-label="Dismiss error">
            Dismiss
          </button>
        </div>
      ) : pendingPlan ? (
        <div className="alfred-dock-plan">
          <div className="plan-name">{pendingPlan.name ?? "Squad"}</div>
          <div className="plan-counts">
            {stagedCount} staged · {liveAlfredCount} live
          </div>
          <div className="plan-actions">
            <button type="button" className="approve-all" onClick={onApproveAll}>
              Approve All
            </button>
            <button type="button" onClick={onRejectAll}>
              Reject All
            </button>
          </div>
          <p className="plan-prompt">"{truncate(pendingPlan.prompt, 140)}"</p>
        </div>
      ) : (
        <p>Manual work stays in front. Alfred will surface only when you ask for a launch plan.</p>
      )}

      <div className="alfred-dock-footer">
        <span>{status.kind}</span>
        <span>local</span>
      </div>
    </aside>
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function TerminalGrid({
  sessions,
  shortcutModifier,
  onCloseSession,
  onApproveTile,
  onRejectTile,
}: {
  sessions: SessionTile[];
  shortcutModifier: string;
  onCloseSession: (sessionId: string) => void;
  onApproveTile: (tileId: string) => void;
  onRejectTile: (tileId: string) => void;
}) {
  return (
    <section className="terminal-stage" aria-label="terminals">
      <header className="terminal-stage-header">
        <div>
          <strong>Terminals</strong>
          <span>{sessions.length} tile{sessions.length === 1 ? "" : "s"} ({sessions.filter(s => s.stage === "staged").length} staged)</span>
        </div>
        <kbd>{shortcutModifier} T</kbd>
      </header>
      <div className="terminal-grid">
        {sessions.map((session) =>
          session.stage === "live" ? (
            <ManualTerminalTile
              cwd={session.cwd}
              key={session.id}
              sessionKey={session.id}
              title={session.title}
              command={session.command}
              args={session.args}
              onClose={() => onCloseSession(session.id)}
            />
          ) : (
            <StagedTilePreview
              key={session.id}
              tile={session}
              onApprove={onApproveTile}
              onReject={onRejectTile}
            />
          ),
        )}
      </div>
    </section>
  );
}

function ManualTerminalTile({
  cwd,
  onClose,
  sessionKey,
  title,
  command,
  args,
}: {
  cwd: string;
  onClose: () => void;
  sessionKey: string;
  title: string;
  command?: string | undefined;
  args?: string[] | undefined;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<TerminalSessionId | null>(null);
  const [status, setStatus] = useState<"connecting" | "ready" | "browser" | "exited" | "error">("connecting");
  const [resolvedCwd, setResolvedCwd] = useState<string>(cwd);

  useEffect(() => {
    const container = containerRef.current;
    const terminalApi = getDesktopTerminalApi();
    let disposed = false;

    if (!container) {
      return;
    }

    sessionIdRef.current = null;
    setResolvedCwd(cwd);
    setStatus("connecting");

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.25,
      theme: {
        background: "#040505",
        foreground: "#d7cebb",
        cursor: "#f5f0e4",
        black: "#050607",
        blue: "#56c8d5",
        brightBlack: "#696357",
        brightBlue: "#9be7ef",
        brightCyan: "#a8edf3",
        brightGreen: "#baf0c6",
        brightMagenta: "#d4c5ff",
        brightRed: "#ffaaa0",
        brightWhite: "#fff8e9",
        brightYellow: "#f5d67f",
        cyan: "#56c8d5",
        green: "#78d991",
        magenta: "#b7a1ff",
        red: "#ef8173",
        white: "#f5f0e4",
        yellow: "#d9ae46",
      },
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const fitAndResize = () => {
      fitAddon.fit();
      const sessionId = sessionIdRef.current;

      if (sessionId && terminalApi) {
        terminalApi.resize({ id: sessionId, cols: terminal.cols, rows: terminal.rows });
      }
    };

    requestAnimationFrame(fitAndResize);

    if (!terminalApi) {
      setStatus("browser");
      terminal.writeln("Manual terminal requires the Electron desktop runtime.");
      terminal.writeln("Open it with: pnpm --filter @alfred/desktop dev:electron");
      return () => {
        terminal.dispose();
      };
    }

    const removeDataListener = terminalApi.onData((event) => {
      if (event.id === sessionIdRef.current) {
        terminal.write(event.data);
      }
    });
    const removeExitListener = terminalApi.onExit((event) => {
      if (event.id === sessionIdRef.current) {
        setStatus("exited");
        terminal.writeln("");
        terminal.writeln(`[process exited with code ${event.exitCode}]`);
      }
    });
    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;

      if (sessionId) {
        terminalApi.write({ id: sessionId, data });
      }
    });
    const resizeObserver = new ResizeObserver(fitAndResize);

    resizeObserver.observe(container);

    const baseRequest: { cols: number; rows: number; cwd?: string; command?: string; args?: string[] } = {
      cols: terminal.cols,
      rows: terminal.rows,
    };
    if (cwd) baseRequest.cwd = cwd;
    if (command) {
      baseRequest.command = command;
      baseRequest.args = args ?? [];
    }
    terminalApi
      .create(baseRequest)
      .then((session) => {
        if (disposed) {
          terminalApi.kill({ id: session.id });
          return;
        }

        sessionIdRef.current = session.id;
        setResolvedCwd(session.cwd);
        setStatus("ready");
        fitAndResize();
        terminal.focus();
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }

        setStatus("error");
        terminal.writeln("Failed to start manual terminal.");
        terminal.writeln(error instanceof Error ? error.message : String(error));
      });

    return () => {
      const sessionId = sessionIdRef.current;

      disposed = true;
      resizeObserver.disconnect();
      inputDisposable.dispose();
      removeDataListener();
      removeExitListener();

      if (sessionId) {
        terminalApi.kill({ id: sessionId });
      }

      terminal.dispose();
    };
  }, [cwd, sessionKey, command, args]);

  return (
    <article className={`terminal-tile manual real-terminal ${status}`}>
      <header className="tile-header">
        <div className="tile-title">
          <span className="tool-dot" />
          <div>
            <b>{title}</b>
            <small>{resolvedCwd ? shortenPath(resolvedCwd) : "runtime cwd"}</small>
          </div>
        </div>
        <div className="tile-actions">
          <span className="tile-status">{statusLabel(status)}</span>
          <button type="button" aria-label={`Close ${title}`} onClick={onClose} title="Close terminal">
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="xterm-host" ref={containerRef} />
    </article>
  );
}

function statusLabel(status: "connecting" | "ready" | "browser" | "exited" | "error"): string {
  switch (status) {
    case "browser":
      return "electron only";
    case "connecting":
      return "starting";
    case "error":
      return "error";
    case "exited":
      return "exited";
    case "ready":
      return "live";
  }
}

function shortenPath(value: string): string {
  const parts = value.split("/");

  if (parts.length <= 3) {
    return value;
  }

  return `…/${parts.slice(-2).join("/")}`;
}
