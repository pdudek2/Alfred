import { Plus, X } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDesktopTerminalApi } from "./desktop-api";
import { addManualSession, closeSession, createInitialSessions, type SessionTile } from "./session-state";
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

  const handleAddManualSession = useCallback(() => {
    setTerminalSessions((sessions) => addManualSession(sessions, ""));
  }, []);

  const handleCloseSession = (sessionId: string) => {
    setTerminalSessions((sessions) => closeSession(sessions, sessionId));
  };

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
      <section className="desktop-frame" aria-label="Alfred Agent Space desktop shell">
        <div className="mission-bar">
          <div className="mission-name">
            <div className="alfred-mark">A</div>
            <div>
              <strong>{workspaceLabels[activeWorkspace]} workspace</strong>
              <span>manual terminals ready</span>
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
          <TerminalGrid sessions={terminalSessions} onCloseSession={handleCloseSession} />
          <AlfredDock />
        </div>
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
          className={`workspace-button ${activeWorkspace === workspace ? "active" : ""} ${workspace === "A" ? "needs-attention" : ""}`}
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

function AlfredDock() {
  return (
    <aside className="alfred-dock" aria-label="Alfred status">
      <div className="alfred-dock-mark">A</div>
      <div>
        <strong>Alfred idle</strong>
        <span>Manual control is active.</span>
      </div>
    </aside>
  );
}

function TerminalGrid({
  sessions,
  onCloseSession,
}: {
  sessions: SessionTile[];
  onCloseSession: (sessionId: string) => void;
}) {
  return (
    <section className="terminal-grid" aria-label="manual terminals">
      {sessions.map((session) => (
        <ManualTerminalTile
          cwd={session.cwd}
          key={session.id}
          sessionKey={session.id}
          title={session.title}
          onClose={() => onCloseSession(session.id)}
        />
      ))}
    </section>
  );
}

function ManualTerminalTile({
  cwd,
  onClose,
  sessionKey,
  title,
}: {
  cwd: string;
  onClose: () => void;
  sessionKey: string;
  title: string;
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

    terminalApi
      .create(cwd ? { cols: terminal.cols, cwd, rows: terminal.rows } : { cols: terminal.cols, rows: terminal.rows })
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
  }, [cwd, sessionKey]);

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
