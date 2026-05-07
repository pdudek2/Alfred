import { X } from "lucide-react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { TileLayout } from "./layout-state";
import type { SessionTile } from "./session-state";

type ArrangePreview = {
  mode: "move" | "resize";
  offsetX: number;
  offsetY: number;
  deltaCol: number;
  deltaRow: number;
};

type StagedTilePreviewProps = {
  arrangeMode: boolean;
  armed: boolean;
  layout?: TileLayout | undefined;
  preview?: ArrangePreview | undefined;
  tile: SessionTile;
  onApprove: (tileId: string) => void;
  onMove: (deltaCol: number, deltaRow: number) => void;
  onPointerMoveStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onReject: (tileId: string) => void;
  onResize: (deltaColSpan: number, deltaRowSpan: number) => void;
};

export function StagedTilePreview({
  arrangeMode,
  armed,
  layout,
  preview,
  tile,
  onApprove,
  onMove,
  onPointerMoveStart,
  onPointerResizeStart,
  onReject,
  onResize,
}: StagedTilePreviewProps) {
  const command = tile.command ?? "";
  const args = tile.args ?? [];
  const fullCommand = [command, ...args].join(" ").trim();
  const agentClass = tile.agentKind ?? "shell";
  const unsafe = Boolean(tile.safetyNote);
  const approveLabel = unsafe ? (armed ? "Confirm" : "Review") : "Approve";
  const approveAriaLabel = unsafe
    ? armed
      ? `Confirm unsafe command: ${tile.title}`
      : `Review unsafe command: ${tile.title}`
    : `Approve ${tile.title}`;

  return (
    <article
      className={`terminal-tile staged ${arrangeMode ? "arranging" : ""} ${preview ? `is-${preview.mode === "move" ? "dragging" : "resizing"}` : ""}`}
      aria-label={`Staged ${tile.title}`}
      style={gridStyle(layout, preview)}
    >
      <header
        className={`tile-header ${arrangeMode ? "drag-handle" : ""}`}
        onPointerDown={arrangeMode ? onPointerMoveStart : undefined}
      >
        <div className="tile-title">
          <span className={`tool-dot ${agentClass}`} />
          <div>
            <b>{tile.title}</b>
            <small>{tile.cwd ? shortenPath(tile.cwd) : "default cwd"}</small>
          </div>
        </div>
        <div className="tile-actions">
          <span className="tile-status">staged</span>
        </div>
      </header>
      {arrangeMode && <ArrangeControls onMove={onMove} onResize={onResize} />}
      <div className="staged-body">
        {unsafe && (
          <div className={`staged-safety-chip ${armed ? "armed" : ""}`} role="note">
            {armed ? "Confirm to launch: " : "Review before launch: "}
            {tile.safetyNote}
          </div>
        )}
        <div className="staged-label">command</div>
        <div className="staged-command">{fullCommand || "(no command)"}</div>
        {tile.cwd && <div className="staged-cwd">cwd: {tile.cwd}</div>}
      </div>
      <div className="staged-actions">
        <button
          type="button"
          className={`approve-button ${unsafe ? "unsafe" : ""} ${armed ? "armed" : ""}`}
          onClick={() => onApprove(tile.id)}
          aria-label={approveAriaLabel}
        >
          {approveLabel}
        </button>
        <button
          type="button"
          className="reject-button"
          onClick={() => onReject(tile.id)}
          aria-label={`Reject ${tile.title}`}
          title="Reject"
        >
          <X size={14} />
        </button>
      </div>
      {arrangeMode && (
        <button
          className="tile-resize-handle"
          type="button"
          aria-label={`Resize ${tile.title}`}
          onPointerDown={onPointerResizeStart}
        />
      )}
    </article>
  );
}

function ArrangeControls({
  onMove,
  onResize,
}: {
  onMove: (deltaCol: number, deltaRow: number) => void;
  onResize: (deltaColSpan: number, deltaRowSpan: number) => void;
}) {
  return (
    <div className="arrange-controls" aria-label="tile arrange controls">
      <button type="button" onClick={() => onMove(-1, 0)} aria-label="Move left">←</button>
      <button type="button" onClick={() => onMove(1, 0)} aria-label="Move right">→</button>
      <button type="button" onClick={() => onMove(0, -1)} aria-label="Move up">↑</button>
      <button type="button" onClick={() => onMove(0, 1)} aria-label="Move down">↓</button>
      <button type="button" onClick={() => onResize(1, 0)} aria-label="Widen">W+</button>
      <button type="button" onClick={() => onResize(-1, 0)} aria-label="Narrow">W-</button>
      <button type="button" onClick={() => onResize(0, 1)} aria-label="Taller">H+</button>
      <button type="button" onClick={() => onResize(0, -1)} aria-label="Shorter">H-</button>
    </div>
  );
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

function shortenPath(value: string): string {
  const parts = value.split("/");
  if (parts.length <= 3) return value;
  return `…/${parts.slice(-2).join("/")}`;
}
