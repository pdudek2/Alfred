import { X } from "lucide-react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { TileLayout } from "./layout-state";
import type { SessionTile } from "./session-state";
import type { ArrangePreview } from "./terminal-desk-types";
import { sessionTileKind, tileKindMeta } from "./tile-kind";
import { TileKindIcon } from "./tile-kind-icon";
import { shortenPath } from "./path-display";

type StagedTilePreviewProps = {
  arrangeMode: boolean;
  armed: boolean;
  layout?: TileLayout | undefined;
  preview?: ArrangePreview | undefined;
  selected: boolean;
  tile: SessionTile;
  onApprove: (tileId: string) => void;
  onFocusSession: () => void;
  onSelectSession: () => void;
  onPointerMoveStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onReject: (tileId: string) => void;
};

export function StagedTilePreview({
  arrangeMode,
  armed,
  layout,
  preview,
  selected,
  tile,
  onApprove,
  onFocusSession,
  onSelectSession,
  onPointerMoveStart,
  onPointerResizeStart,
  onReject,
}: StagedTilePreviewProps) {
  const command = tile.command ?? "";
  const args = tile.args ?? [];
  const fullCommand = [command, ...args].join(" ").trim();
  const kind = sessionTileKind(tile);
  const kindMeta = tileKindMeta(kind);
  const isolated = tile.isolation === "worktree";
  const checking = tile.stagedReviewStatus === "checking";
  const edited = tile.stagedReviewStatus === "edited";
  const launchBlocked = tile.launchPreflight?.status === "blocked";
  const launchBlockReason = tile.launchPreflight?.status === "blocked" ? tile.launchPreflight.reason : null;
  const unsafe = Boolean(tile.safetyNote) && !launchBlocked;
  const approveLabel = checking ? "Checking" : launchBlocked ? "Blocked" : unsafe ? (armed ? "Confirm" : "Review") : "Launch";
  const approveAriaLabel = checking
    ? `Checking edited command: ${tile.title}`
    : launchBlocked
    ? `Launch blocked: ${tile.title}`
    : unsafe
    ? armed
      ? `Confirm unsafe command: ${tile.title}`
      : `Review unsafe command: ${tile.title}`
    : `Launch ${tile.title}`;

  return (
    <article
      className={`terminal-tile staged kind-${kindMeta.className} ${selected ? "selected" : ""} ${arrangeMode ? "arranging" : ""} ${preview ? `is-${preview.mode === "move" ? "dragging" : "resizing"}` : ""}`}
      aria-label={`Staged ${tile.title}`}
      style={gridStyle(layout, preview)}
      tabIndex={0}
      onFocus={onSelectSession}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onFocusSession();
        }
      }}
    >
      <header
        className={`tile-header ${arrangeMode ? "drag-handle" : ""}`}
        onClick={!arrangeMode ? onSelectSession : undefined}
        onDoubleClick={!arrangeMode ? onFocusSession : undefined}
        onPointerDown={arrangeMode ? onPointerMoveStart : undefined}
      >
        <div className="tile-title">
          <span className={`tool-dot ${kindMeta.className}`} />
          <span className={`tile-kind-mark ${kindMeta.className}`} title={kindMeta.label}>
            <TileKindIcon kind={kind} />
            <span>{kindMeta.shortLabel}</span>
          </span>
          <div>
            <b>{tile.title}</b>
            <small>{kindMeta.label} · {tile.cwd ? shortenPath(tile.cwd) : "default cwd"}</small>
          </div>
        </div>
        <div className="tile-actions">
          <span className={`tile-status ${checking ? "status-checking" : launchBlocked ? "status-blocked" : ""}`}>
            {checking ? "checking" : launchBlocked ? "blocked" : "ready"}
          </span>
        </div>
      </header>
      <div className="staged-body">
        {edited && !checking && (
          <div className="staged-edited-chip" role="note">
            edited · rechecked
          </div>
        )}
        {unsafe && (
          <div className={`staged-safety-chip ${armed ? "armed" : ""}`} role="note">
            {armed ? "Confirm to launch: " : "Review before launch: "}
            {tile.safetyNote}
          </div>
        )}
        {launchBlocked && (
          <div className="staged-safety-chip blocked" role="note">
            Launch blocked: {launchBlockReason}
          </div>
        )}
        <div className="staged-label">Will launch</div>
        <div className="staged-command">{fullCommand || "(no command)"}</div>
        {isolated && (
          <div className={`staged-isolation ${launchBlocked ? "blocked" : ""}`}>
            {tile.launchPreflight?.status === "ready" && tile.launchPreflight.branchName
              ? `worktree: ${tile.launchPreflight.branchName}`
              : "isolated Git worktree"}
          </div>
        )}
        {tile.launchPreflight?.status === "ready" && tile.launchPreflight.cwd && (
          <div className="staged-cwd">target: {shortenPath(tile.launchPreflight.cwd)}</div>
        )}
        {tile.cwd && <div className="staged-cwd">cwd: {tile.cwd}</div>}
      </div>
      <div className="staged-actions">
        <button
          type="button"
          className={`approve-button ${unsafe ? "unsafe" : ""} ${armed ? "armed" : ""}`}
          onClick={() => onApprove(tile.id)}
          disabled={checking || launchBlocked}
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
