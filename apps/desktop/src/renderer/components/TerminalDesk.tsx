import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Play, ShieldAlert, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { SquadPlan } from "../alfred-state";
import { getDesktopTerminalApi } from "../desktop-api";
import type { LayoutPreset, TileLayout } from "../layout-state";
import type { SessionTile } from "../session-state";
import { StagedTilePreview } from "../staged-tile";
import { sessionTileKind, tileKindMeta } from "../tile-kind";
import { TileKindIcon } from "../tile-kind-icon";
import type { ArrangePointerMode, ArrangePreview, WorkMode } from "../terminal-desk-types";
import type { TerminalCreateRequest, TerminalCreateResult, TerminalSessionId } from "../../shared/terminal-ipc";
import { AgentTimelinePanel } from "./AgentTimelinePanel";

const ARRANGE_GRID_ROW_HEIGHT = 84;

type TerminalDeskProps = {
  arrangeMode: boolean;
  armedUnsafeSessionIds: Set<string>;
  layouts: Record<string, TileLayout>;
  pendingPlan: SquadPlan | null;
  sessions: SessionTile[];
  shortcutModifier: string;
  safeStagedCount: number;
  unsafeStagedCount: number;
  workMode: WorkMode;
  onCloseSession: (sessionId: string) => void;
  onApplyLayoutPreset: (preset: LayoutPreset) => void;
  onApplyWorkMode: (mode: WorkMode) => void;
  onApproveAll: () => void;
  onMoveTile: (tileId: string, deltaCol: number, deltaRow: number) => void;
  onRejectAll: () => void;
  onRuntimeSessionFailed: (tileId: string) => void;
  onRuntimeSessionReady: (tileId: string, runtime: TerminalCreateResult) => void;
  onRuntimeSessionStarting: (tileId: string) => boolean;
  onApproveTile: (tileId: string) => void;
  onRejectTile: (tileId: string) => void;
  onResizeTile: (tileId: string, deltaColSpan: number, deltaRowSpan: number) => void;
};

export function TerminalDesk({
  arrangeMode,
  armedUnsafeSessionIds,
  layouts,
  pendingPlan,
  sessions,
  shortcutModifier,
  safeStagedCount,
  unsafeStagedCount,
  workMode,
  onCloseSession,
  onApplyLayoutPreset,
  onApplyWorkMode,
  onApproveAll,
  onMoveTile,
  onRejectAll,
  onRuntimeSessionFailed,
  onRuntimeSessionReady,
  onRuntimeSessionStarting,
  onApproveTile,
  onRejectTile,
  onResizeTile,
}: TerminalDeskProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [arrangePreview, setArrangePreview] = useState<ArrangePreview | null>(null);
  const gridDensity = sessions.length <= 1 ? "single" : sessions.length === 2 ? "split" : "dense";
  const startPointerArrange = useCallback(
    (tileId: string, mode: ArrangePointerMode, event: ReactPointerEvent<HTMLElement>) => {
      if (!arrangeMode) return;
      if (mode === "move" && (event.target as HTMLElement).closest("button")) return;
      const grid = gridRef.current;
      const layout = layouts[tileId];
      if (!grid || !layout) return;

      event.preventDefault();
      const rect = grid.getBoundingClientRect();
      const colWidth = rect.width > 0 ? rect.width / 12 : 80;
      const startX = event.clientX;
      const startY = event.clientY;
      let finalDeltaCol = 0;
      let finalDeltaRow = 0;

      setArrangePreview({
        tileId,
        mode,
        offsetX: 0,
        offsetY: 0,
        deltaCol: 0,
        deltaRow: 0,
      });
      document.body.classList.add("arranging-pointer");

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const offsetX = moveEvent.clientX - startX;
        const offsetY = moveEvent.clientY - startY;
        finalDeltaCol = Math.round(offsetX / colWidth);
        finalDeltaRow = Math.round(offsetY / ARRANGE_GRID_ROW_HEIGHT);
        setArrangePreview({
          tileId,
          mode,
          offsetX,
          offsetY,
          deltaCol: finalDeltaCol,
          deltaRow: finalDeltaRow,
        });
      };

      const stopPointerArrange = (commit: boolean) => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", commitPointerArrange);
        window.removeEventListener("pointercancel", cancelPointerArrange);
        document.body.classList.remove("arranging-pointer");
        setArrangePreview(null);

        if (!commit) return;
        if (finalDeltaCol === 0 && finalDeltaRow === 0) return;

        if (mode === "move") {
          onMoveTile(tileId, finalDeltaCol, finalDeltaRow);
        } else {
          onResizeTile(tileId, finalDeltaCol, finalDeltaRow);
        }
      };
      const commitPointerArrange = () => stopPointerArrange(true);
      const cancelPointerArrange = () => stopPointerArrange(false);

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", commitPointerArrange);
      window.addEventListener("pointercancel", cancelPointerArrange);
    },
    [arrangeMode, layouts, onMoveTile, onResizeTile],
  );

  return (
    <section className={`terminal-stage ${arrangeMode ? "arranging" : ""} ${pendingPlan ? "has-plan" : ""} mode-${workMode}`} aria-label="terminals">
      <header className="terminal-stage-header">
        <div>
          <strong>Desk</strong>
          <span>
            {sessions.length} tile{sessions.length === 1 ? "" : "s"} · {sessions.filter((s) => s.stage === "staged").length} staged
          </span>
        </div>
        <div className="layout-controls" aria-label="layout controls">
          {arrangeMode && (
            <>
              <button type="button" onClick={() => onApplyLayoutPreset("focus")}>
                Full
              </button>
              <button type="button" onClick={() => onApplyLayoutPreset("two-up")}>
                Split
              </button>
              <button type="button" onClick={() => onApplyLayoutPreset("grid")}>
                Tiled
              </button>
              <span className="arrange-hint">drag header · resize corner</span>
            </>
          )}
          {!arrangeMode && sessions.length > 0 && (
            <div className="work-mode-control" aria-label="work mode">
              <button
                type="button"
                className={workMode === "focus" ? "active" : ""}
                aria-pressed={workMode === "focus"}
                onClick={() => onApplyWorkMode("focus")}
              >
                Focus
              </button>
              <button
                type="button"
                className={workMode === "split" ? "active" : ""}
                aria-pressed={workMode === "split"}
                onClick={() => onApplyWorkMode("split")}
              >
                Split
              </button>
              <button
                type="button"
                className={workMode === "desk" ? "active" : ""}
                aria-pressed={workMode === "desk"}
                onClick={() => onApplyWorkMode("desk")}
              >
                Desk
              </button>
            </div>
          )}
          <kbd>{shortcutModifier} T</kbd>
        </div>
      </header>
      {pendingPlan && (
        <LaunchPlanStrip
          pendingPlan={pendingPlan}
          safeStagedCount={safeStagedCount}
          unsafeStagedCount={unsafeStagedCount}
          onApproveAll={onApproveAll}
          onRejectAll={onRejectAll}
        />
      )}
      <div className="terminal-stage-body">
      <div className={`terminal-grid ${arrangeMode ? "arranging" : "laid-out"} ${gridDensity}`} ref={gridRef}>
        {sessions.map((session) =>
          session.stage === "live" ? (
            <ManualTerminalTile
              arrangeMode={arrangeMode}
              cwd={session.cwd}
              key={session.id}
              layout={layouts[session.id]}
              preview={arrangePreview?.tileId === session.id ? arrangePreview : undefined}
              sessionKey={session.id}
              runtimeId={session.runtimeId}
              workspaceId={session.workspaceId}
              title={session.title}
              source={session.source}
              agentKind={session.agentKind}
              command={session.command}
              args={session.args}
              initialBuffer={session.initialBuffer}
              onClose={() => onCloseSession(session.id)}
              onPointerMoveStart={(event) => startPointerArrange(session.id, "move", event)}
              onPointerResizeStart={(event) => startPointerArrange(session.id, "resize", event)}
              onRuntimeSessionFailed={onRuntimeSessionFailed}
              onRuntimeSessionReady={onRuntimeSessionReady}
              onRuntimeSessionStarting={onRuntimeSessionStarting}
            />
          ) : (
            <StagedTilePreview
              armed={armedUnsafeSessionIds.has(session.id)}
              key={session.id}
              layout={layouts[session.id]}
              preview={arrangePreview?.tileId === session.id ? arrangePreview : undefined}
              tile={session}
              onApprove={onApproveTile}
              onPointerMoveStart={(event) => startPointerArrange(session.id, "move", event)}
              onReject={onRejectTile}
              onPointerResizeStart={(event) => startPointerArrange(session.id, "resize", event)}
              arrangeMode={arrangeMode}
            />
          ),
        )}
      </div>
      {workMode === "focus" && (
        <AgentTimelinePanel session={focusedSession(sessions, layouts)} />
      )}
      </div>
    </section>
  );
}

function LaunchPlanStrip({
  pendingPlan,
  safeStagedCount,
  unsafeStagedCount,
  onApproveAll,
  onRejectAll,
}: {
  pendingPlan: SquadPlan;
  safeStagedCount: number;
  unsafeStagedCount: number;
  onApproveAll: () => void;
  onRejectAll: () => void;
}) {
  const totalStagedCount = pendingPlan.sessionIds.length;

  return (
    <section className="launch-plan-strip" aria-label="Alfred launch plan">
      <div className="launch-plan-mark" aria-hidden="true">
        A
      </div>
      <div className="launch-plan-copy">
        <span>Workspace prepared</span>
        <strong>{pendingPlan.name ?? "Alfred plan"}</strong>
        <p>
          {totalStagedCount} proposed tile{totalStagedCount === 1 ? "" : "s"}
          {unsafeStagedCount > 0 ? ` · ${unsafeStagedCount} need review` : " · ready to launch"}
        </p>
      </div>
      {unsafeStagedCount > 0 && (
        <div className="launch-plan-warning" role="note">
          <ShieldAlert size={14} />
          <span>Unsafe commands stay staged.</span>
        </div>
      )}
      <div className="launch-plan-actions">
        <button type="button" className="launch-primary" onClick={onApproveAll} disabled={safeStagedCount === 0}>
          <Play size={14} />
          {unsafeStagedCount > 0 ? "Launch safe" : "Launch all"}
        </button>
        <button type="button" className="launch-secondary" onClick={onRejectAll}>
          Clear plan
        </button>
      </div>
    </section>
  );
}

function ManualTerminalTile({
  arrangeMode,
  cwd,
  agentKind,
  initialBuffer,
  layout,
  preview,
  onClose,
  onPointerMoveStart,
  onPointerResizeStart,
  onRuntimeSessionFailed,
  onRuntimeSessionReady,
  onRuntimeSessionStarting,
  runtimeId,
  sessionKey,
  source,
  workspaceId,
  title,
  command,
  args,
}: {
  arrangeMode: boolean;
  cwd: string;
  agentKind?: SessionTile["agentKind"];
  initialBuffer?: string | undefined;
  layout?: TileLayout | undefined;
  preview?: ArrangePreview | undefined;
  onClose: () => void;
  onPointerMoveStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onRuntimeSessionFailed: (tileId: string) => void;
  onRuntimeSessionReady: (tileId: string, runtime: TerminalCreateResult) => void;
  onRuntimeSessionStarting: (tileId: string) => boolean;
  runtimeId?: TerminalSessionId | undefined;
  sessionKey: string;
  source: SessionTile["source"];
  workspaceId: string;
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
  const kind = sessionTileKind({ agentKind, source });
  const kindMeta = tileKindMeta(kind);

  useEffect(() => {
    const container = containerRef.current;
    const terminalApi = getDesktopTerminalApi();
    let disposed = false;

    if (!container) {
      return;
    }

    sessionIdRef.current = runtimeId ?? null;
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

    if (runtimeId) {
      sessionIdRef.current = runtimeId;
      setStatus("ready");
      if (initialBuffer) {
        terminal.write(initialBuffer);
      }
      requestAnimationFrame(fitAndResize);
      terminal.focus();

      return () => {
        disposed = true;
        resizeObserver.disconnect();
        inputDisposable.dispose();
        removeDataListener();
        removeExitListener();
        terminal.dispose();
      };
    }

    if (!onRuntimeSessionStarting(sessionKey)) {
      terminal.writeln("Terminal start is already in progress...");
      return () => {
        disposed = true;
        resizeObserver.disconnect();
        inputDisposable.dispose();
        removeDataListener();
        removeExitListener();
        terminal.dispose();
      };
    }

    const baseRequest: TerminalCreateRequest = {
      cols: terminal.cols,
      rows: terminal.rows,
      clientId: sessionKey,
      title,
      source,
      workspaceId,
    };
    if (agentKind) baseRequest.agentKind = agentKind;
    if (cwd) baseRequest.cwd = cwd;
    if (command) {
      baseRequest.command = command;
      baseRequest.args = args ?? [];
    }
    terminalApi
      .create(baseRequest)
      .then((session) => {
        onRuntimeSessionReady(sessionKey, session);

        if (disposed) {
          return;
        }

        sessionIdRef.current = session.id;
        setResolvedCwd(session.cwd);
        setStatus("ready");
        fitAndResize();
        terminal.focus();
      })
      .catch((error: unknown) => {
        onRuntimeSessionFailed(sessionKey);
        if (disposed) {
          return;
        }

        setStatus("error");
        terminal.writeln("Failed to start manual terminal.");
        terminal.writeln(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      inputDisposable.dispose();
      removeDataListener();
      removeExitListener();

      terminal.dispose();
    };
  }, [
    cwd,
    sessionKey,
    title,
    source,
    workspaceId,
    agentKind,
    command,
    args,
    initialBuffer,
    runtimeId,
    onRuntimeSessionFailed,
    onRuntimeSessionReady,
    onRuntimeSessionStarting,
  ]);

  return (
    <article
      className={`terminal-tile manual real-terminal kind-${kindMeta.className} ${status} ${arrangeMode ? "arranging" : ""} ${preview ? `is-${preview.mode === "move" ? "dragging" : "resizing"}` : ""}`}
      aria-label={title}
      style={gridStyle(layout, preview)}
    >
      <header
        className={`tile-header ${arrangeMode ? "drag-handle" : ""}`}
        onPointerDown={arrangeMode ? onPointerMoveStart : undefined}
      >
        <div className="tile-title">
          <span className={`tool-dot ${kindMeta.className}`} />
          <span className={`tile-kind-mark ${kindMeta.className}`} title={kindMeta.label}>
            <TileKindIcon kind={kind} />
            <span>{kindMeta.shortLabel}</span>
          </span>
          <div>
            <b>{title}</b>
            <small>
              {kindMeta.label} · {resolvedCwd ? shortenPath(resolvedCwd) : "runtime cwd"}
            </small>
          </div>
        </div>
        <div className="tile-actions">
          <span className="tile-status">{statusLabel(status)}</span>
          <button
            type="button"
            aria-label={`Close ${title}`}
            onClick={onClose}
            onPointerDown={(event) => event.stopPropagation()}
            title="Close terminal"
          >
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="xterm-host" ref={containerRef} />
      {arrangeMode && (
        <button
          className="tile-resize-handle"
          type="button"
          aria-label={`Resize ${title}`}
          onPointerDown={onPointerResizeStart}
        />
      )}
    </article>
  );
}

function focusedSession(sessions: SessionTile[], layouts: Record<string, TileLayout>): SessionTile | null {
  let best: { session: SessionTile; area: number } | null = null;
  for (const session of sessions) {
    if (session.stage !== "live") continue;
    const layout = layouts[session.id];
    if (!layout) continue;
    const area = layout.colSpan * layout.rowSpan;
    if (!best || area > best.area) best = { session, area };
  }
  return best?.session ?? null;
}

function gridStyle(layout: TileLayout | undefined, preview?: ArrangePreview | undefined): CSSProperties | undefined {
  if (!layout) return undefined;
  const style: CSSProperties & Record<string, string | number> = {
    gridColumn: `${layout.col} / span ${layout.colSpan}`,
    gridRow: `${layout.row} / span ${layout.rowSpan}`,
  };

  if (preview) {
    style["--arrange-x"] = `${preview.offsetX}px`;
    style["--arrange-y"] = `${preview.offsetY}px`;
    style["--arrange-cols"] = String(preview.deltaCol);
    style["--arrange-rows"] = String(preview.deltaRow);
  }

  if (preview?.mode === "move") {
    style.transform = `translate3d(${preview.offsetX}px, ${preview.offsetY}px, 0)`;
    style.zIndex = 6;
  }

  return style;
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
