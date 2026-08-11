import { X } from "lucide-react";
import type {
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { TileLayout } from "./layout-state";
import type { SessionTile } from "./session-state";
import type { ArrangePreview } from "./terminal-desk-types";
import { sessionTileKind, tileKindMeta } from "./tile-kind";
import { TileKindIcon } from "./tile-kind-icon";

type StagedTilePreviewProps = {
  arrangeMode: boolean;
  focusHidden?: boolean;
  layout?: TileLayout | undefined;
  preview?: ArrangePreview | undefined;
  selected: boolean;
  tile: SessionTile;
  onApprove: (tileId: string) => void;
  onArrangeKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onFocusSession: () => void;
  onSelectSession: () => void;
  onPointerMoveStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onReject: (tileId: string) => void;
};

export function StagedTilePreview({
  arrangeMode,
  focusHidden = false,
  layout,
  preview,
  selected,
  tile,
  onApprove,
  onArrangeKeyDown,
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
  const launchMode = isolated
    ? tile.launchPreflight?.status === "ready" && tile.launchPreflight.branchName
      ? `isolated checkout: ${tile.launchPreflight.branchName}`
      : "isolated checkout"
    : "normal workspace";
  const checking = tile.stagedReviewStatus === "checking";
  const edited = tile.stagedReviewStatus === "edited";
  const launchBlocked = tile.launchPreflight?.status === "blocked" || Boolean(tile.safetyNote);
  const launchBlockReason = tile.launchPreflight?.status === "blocked" ? tile.launchPreflight.reason : tile.safetyNote ?? null;
  const approveLabel = checking ? "Checking" : launchBlocked ? "Blocked" : "Launch";
  const approveAriaLabel = checking
    ? `Checking edited command: ${tile.title}`
    : launchBlocked
      ? `Launch blocked: ${tile.title}`
      : `Launch ${tile.title}`;

  return (
    <article
      className={`terminal-tile staged kind-${kindMeta.className} ${selected ? "selected" : ""} ${focusHidden ? "focus-hidden" : ""} ${arrangeMode ? "arranging" : ""} ${preview ? `is-${preview.mode === "move" ? "dragging" : "resizing"}` : ""}`}
      data-testid="terminal-tile"
      data-session-id={tile.id}
      aria-label={`Staged ${tile.title}`}
      aria-hidden={focusHidden ? "true" : undefined}
      style={gridStyle(layout, preview)}
      tabIndex={focusHidden ? -1 : 0}
      onFocus={(event) => {
        if (focusEnteredTile(event)) onSelectSession();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (arrangeMode) {
          onArrangeKeyDown(event);
          return;
        }
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
          <span className={`tile-kind-mark ${kindMeta.className}`} title={kindMeta.label}>
            <TileKindIcon kind={kind} />
            <span className="tile-kind-label">{kindMeta.shortLabel}</span>
          </span>
          <div>
            <b>{tile.title}</b>
            <small>{kindMeta.label}</small>
          </div>
        </div>
        <div className="tile-actions">
          <span className={`tile-status ${checking ? "status-checking" : launchBlocked ? "status-blocked" : ""}`}>
            {checking ? "checking" : launchBlocked ? "blocked" : "staged"}
          </span>
        </div>
      </header>
      <div className="staged-body">
        {edited && !checking && (
          <div className="staged-edited-chip" role="note">
            edited · rechecked
          </div>
        )}
        {launchBlocked && (
          <div className="staged-safety-chip blocked" role="note">
            Launch blocked: {launchBlockReason}
          </div>
        )}
        <div className="staged-command">{fullCommand || "(no command)"}</div>
        <div className={`staged-isolation ${launchBlocked ? "blocked" : ""}`}>
          {isolated ? launchMode : "shared workspace"}
        </div>
      </div>
      <div className="staged-actions">
        <button
          type="button"
          className="approve-button"
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
  }

  if (preview?.mode === "move") {
    style.transform = `translate3d(${preview.offsetX}px, ${preview.offsetY}px, 0)`;
    style.zIndex = 6;
  }

  return style;
}

function focusEnteredTile(event: ReactFocusEvent<HTMLElement>): boolean {
  const relatedTarget = event.relatedTarget;
  return !(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget);
}
