import {
  ArrowLeft,
  ArrowRight,
  Columns3,
  Maximize2,
  RefreshCw,
  SquareTerminal,
} from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { getDesktopTerminalApi } from "./desktop-api";
import type { TerminalSessionId } from "../shared/terminal-ipc";
import "@xterm/xterm/css/xterm.css";

type TerminalTile = {
  title: string;
  accelerator: string;
  state: "active" | "needs" | "manual" | "ready" | "idle";
  body: string[];
  footerLeft: string;
  footerRight: string;
};

type LayoutMode = "default" | "terminal-wall" | "preview-focus";
type WorkspaceId = "A" | "UI" | "API" | "DOC";

const workspaceLabels: Record<WorkspaceId, string> = {
  A: "Alfred",
  API: "API",
  DOC: "Docs",
  UI: "UI",
};

const terminalTiles: TerminalTile[] = [
  {
    title: "Codex · UI shell",
    accelerator: "⌘1",
    state: "active",
    body: ["Mapped repo", "apps/desktop pending", "waiting for plan gate"],
    footerLeft: "planned",
    footerRight: "worktree",
  },
  {
    title: "Claude · a11y pass",
    accelerator: "!",
    state: "needs",
    body: ["Needs you", "glass density?", "confirm before spec"],
    footerLeft: "needs you",
    footerRight: "open",
  },
  {
    title: "Manual · zsh",
    accelerator: "$",
    state: "manual",
    body: ["/Users/patryk/Desktop/Alfred", "$ codex resume", "$ ghostty ."],
    footerLeft: "manual",
    footerRight: "free control",
  },
  {
    title: "pnpm dev",
    accelerator: "✓",
    state: "ready",
    body: ["ready", "web 4300", "api 4301"],
    footerLeft: "shared",
    footerRight: "main",
  },
  {
    title: "Tests",
    accelerator: "·",
    state: "idle",
    body: ["queued checks", "pnpm test", "typecheck"],
    footerLeft: "idle",
    footerRight: "queue",
  },
  {
    title: "Review",
    accelerator: "·",
    state: "idle",
    body: ["PR notes", "browser smoke", "no trailers"],
    footerLeft: "planned",
    footerRight: "guards",
  },
];

const planSteps = [
  { state: "watch", label: "Map repo boundaries", tag: "done" },
  { state: "ask", label: "Create ui-shell worktree", tag: "review" },
  { state: "ask", label: "Launch browser preview", tag: "review" },
  { state: "run", label: "Keep manual zsh open", tag: "free" },
  { state: "block", label: "Confirm density target", tag: "open" },
];

export function App() {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("default");
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>("A");

  return (
    <main className="agent-space-shell">
      <header className="intro-bar">
        <div>
          <p className="eyebrow">Desktop shell foundation</p>
          <h1>Instrument Glass cockpit</h1>
          <p className="intro-copy">
            Static first slice for Alfred Agent Space: glass control layers, matte terminals, a visible
            manual path, and no fake runtime behavior.
          </p>
        </div>
        <div className="rules" aria-label="design constraints">
          <span>glass controls</span>
          <span>matte terminals</span>
          <span>44px targets</span>
          <span>manual first</span>
        </div>
      </header>

      <section className="desktop-frame" aria-label="Alfred Agent Space desktop shell">
        <div className="window-chrome">
          <div className="traffic" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="window-title">Alfred Agent Space · Workspace Alfred</div>
          <div className="window-time">Shell preview</div>
        </div>

        <div className="mission-bar">
          <div className="mission-name">
            <div className="alfred-mark">A</div>
            <div>
              <strong>{workspaceLabels[activeWorkspace]} workspace</strong>
              <span>{layoutModeLabel(layoutMode)} mode · manual shell ready · planner offline</span>
            </div>
          </div>
          <div className="mission-actions" aria-label="focus modes">
            <button
              type="button"
              aria-label="Default cockpit mode"
              aria-pressed={layoutMode === "default"}
              onClick={() => setLayoutMode("default")}
              title="Default cockpit"
            >
              <SquareTerminal size={17} />
            </button>
            <button
              type="button"
              aria-label="Terminal wall mode"
              aria-pressed={layoutMode === "terminal-wall"}
              onClick={() => setLayoutMode("terminal-wall")}
              title="Terminal wall"
            >
              <Columns3 size={17} />
            </button>
            <button
              type="button"
              aria-label="Preview focus mode"
              aria-pressed={layoutMode === "preview-focus"}
              onClick={() => setLayoutMode("preview-focus")}
              title="Preview focus"
            >
              <Maximize2 size={17} />
            </button>
          </div>
        </div>

        <div className={`workspace-layout ${layoutMode}`}>
          <WorkspaceRail activeWorkspace={activeWorkspace} onSelectWorkspace={setActiveWorkspace} />
          <AlfredRail />
          <TerminalGrid />
          <BrowserPane />
        </div>

        <footer className="composer-bar">
          <div className="mode-pill">
            <SquareTerminal size={16} />
            {layoutModeLabel(layoutMode)}
          </div>
          <div className="alfred-voice">
            <b>Alfred:</b> I’ll stage the squad and ask before launch.
          </div>
          <div className="composer-input">Prepare the desktop UI shell, but keep terminals solid.</div>
          <div className="composer-actions">
            <span className="composer-status">planner runtime not connected</span>
          </div>
        </footer>
      </section>
    </main>
  );
}

function layoutModeLabel(layoutMode: LayoutMode): string {
  switch (layoutMode) {
    case "default":
      return "cockpit";
    case "preview-focus":
      return "preview";
    case "terminal-wall":
      return "wall";
  }
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

function AlfredRail() {
  return (
    <aside className="alfred-rail" aria-label="Alfred plan rail">
      <div className="decision-spine" />
      <div className="rail-content">
        <p className="panel-label">Alfred</p>
        <h2>
          Review before <em>launch</em>
        </h2>
        <div className="prompt-card">
          I can prepare the terminals and worktrees, but I will wait before running agents or touching shared services.
        </div>
        <div className="plan-list">
          {planSteps.map((step) => (
            <div className="plan-step" key={step.label}>
              <span className={`status-dot ${step.state}`} />
              <span>{step.label}</span>
              <span className={step.state === "ask" ? "step-tag review" : "step-tag"}>{step.tag}</span>
            </div>
          ))}
        </div>
        <p className="rail-note">Decision spine marks Alfred-owned actions only. Ordinary session state stays quiet.</p>
      </div>
    </aside>
  );
}

function TerminalGrid() {
  return (
    <section className="terminal-grid" aria-label="terminal grid">
      {terminalTiles.map((tile) => (
        <TerminalTileView key={tile.title} tile={tile} />
      ))}
    </section>
  );
}

function TerminalTileView({ tile }: { tile: TerminalTile }) {
  if (tile.state === "manual") {
    return <ManualTerminalTile tile={tile} />;
  }

  return (
    <article className={`terminal-tile ${tile.state}`}>
      <header className="tile-header">
        <div className="tile-title">
          <span className="tool-dot" />
          <b>{tile.title}</b>
        </div>
        <span>{tile.accelerator}</span>
      </header>
      <div className="terminal-body">
        {tile.body.map((line, index) => (
          <p key={line} className={index === 0 ? "strong-line" : undefined}>
            {line}
            {tile.state === "active" && index === tile.body.length - 1 ? <span className="cursor" /> : null}
          </p>
        ))}
      </div>
      <footer className="tile-footer">
        <span>{tile.footerLeft}</span>
        <span>{tile.footerRight}</span>
      </footer>
    </article>
  );
}

function ManualTerminalTile({ tile }: { tile: TerminalTile }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<TerminalSessionId | null>(null);
  const [status, setStatus] = useState<"connecting" | "ready" | "browser" | "exited" | "error">("connecting");
  const [cwd, setCwd] = useState<string>(tile.body[0] ?? "");

  useEffect(() => {
    const container = containerRef.current;
    const terminalApi = getDesktopTerminalApi();

    if (!container) {
      return;
    }

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
      .create({ cols: terminal.cols, rows: terminal.rows })
      .then((session) => {
        sessionIdRef.current = session.id;
        setCwd(session.cwd);
        setStatus("ready");
        fitAndResize();
      })
      .catch((error: unknown) => {
        setStatus("error");
        terminal.writeln("Failed to start manual terminal.");
        terminal.writeln(error instanceof Error ? error.message : String(error));
      });

    return () => {
      const sessionId = sessionIdRef.current;

      resizeObserver.disconnect();
      inputDisposable.dispose();
      removeDataListener();
      removeExitListener();

      if (sessionId) {
        terminalApi.kill({ id: sessionId });
      }

      terminal.dispose();
    };
  }, [tile.body]);

  return (
    <article className={`terminal-tile manual real-terminal ${status}`}>
      <header className="tile-header">
        <div className="tile-title">
          <span className="tool-dot" />
          <b>{tile.title}</b>
        </div>
        <span>{statusLabel(status)}</span>
      </header>
      <div className="xterm-host" ref={containerRef} />
      <footer className="tile-footer">
        <span>{status === "ready" ? "live pty" : statusLabel(status)}</span>
        <span>{shortenPath(cwd)}</span>
      </footer>
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

function BrowserPane() {
  return (
    <aside className="browser-pane" aria-label="browser preview">
      <header className="browser-header">
        <div>
          <p className="panel-label">Preview</p>
          <h2>Alfred Web</h2>
        </div>
        <div className="browser-tools" aria-label="browser controls unavailable">
          <span className="chrome-button" aria-hidden="true">
            <ArrowLeft size={16} />
          </span>
          <span className="chrome-button" aria-hidden="true">
            <ArrowRight size={16} />
          </span>
          <span className="chrome-button" aria-hidden="true">
            <RefreshCw size={16} />
          </span>
        </div>
      </header>

      <div className="url-bar">
        <span className="live-dot" />
        <span>localhost:4300/?view=reader</span>
      </div>

      <div className="preview-surface">
        <div className="preview-top">
          <div className="preview-brand">
            <div className="alfred-mark small">A</div>
            <b>Alfred</b>
          </div>
          <span>Tuesday 10:33</span>
        </div>
        <div className="preview-content">
          <h3>Loaded runs from last 7 days</h3>
          <PreviewRun state="ask" title="Alfred · waiting on you" meta="Codex · waiting since May 05, 10:47 AM" label="needs you" />
          <PreviewRun state="block" title="patryk · interrupted session" meta="Codex · last activity 11h ago" label="problem" />
          <PreviewRun state="run" title="Alfred · completed reader shell" meta="Codex · browser smoke pending" label="done" />
        </div>
      </div>

      <footer className="review-strip">
        <span>sample preview</span>
        <span>live browser not connected</span>
      </footer>
    </aside>
  );
}

function PreviewRun({
  state,
  title,
  meta,
  label,
}: {
  state: "ask" | "block" | "run";
  title: string;
  meta: string;
  label: string;
}) {
  return (
    <div className="preview-run">
      <span className={`status-dot ${state}`} />
      <div>
        <b>{title}</b>
        <span>{meta}</span>
      </div>
      <small>{label}</small>
    </div>
  );
}
