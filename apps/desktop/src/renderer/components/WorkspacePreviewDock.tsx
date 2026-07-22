import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  PREVIEW_DOCK_DEFAULT_WIDTH,
  PREVIEW_DOCK_MAX_WIDTH,
  PREVIEW_DOCK_MIN_WIDTH,
} from "../../shared/layout-ipc";
import { WorkspacePreviewPanel, type WorkspacePreviewPanelProps } from "./WorkspacePreviewPanel";
import "./workspace-preview-dock.css";

const PREVIEW_DIVIDER_WIDTH = 8;
const MIN_WORK_SURFACE_WIDTH = 420;
const KEYBOARD_RESIZE_STEP = 16;

export type WorkspacePreviewDockProps = {
  children: ReactNode;
  open: boolean;
  previewProps: WorkspacePreviewPanelProps;
  width: number;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
};

export function WorkspacePreviewDock({
  children,
  open,
  previewProps,
  width,
  onWidthChange,
  onWidthCommit,
}: WorkspacePreviewDockProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const currentWidthRef = useRef(width);
  const hudTimerRef = useRef<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [hudVisible, setHudVisible] = useState(false);
  const maximumWidth = containerWidth > 0
    ? clamp(containerWidth - MIN_WORK_SURFACE_WIDTH - PREVIEW_DIVIDER_WIDTH, PREVIEW_DOCK_MIN_WIDTH, PREVIEW_DOCK_MAX_WIDTH)
    : PREVIEW_DOCK_MAX_WIDTH;
  const renderedWidth = clamp(width, PREVIEW_DOCK_MIN_WIDTH, maximumWidth);
  currentWidthRef.current = renderedWidth;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => setContainerWidth(Math.round(root.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current);
  }, []);

  const showHud = () => {
    setHudVisible(true);
    if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current);
    hudTimerRef.current = window.setTimeout(() => setHudVisible(false), 900);
  };
  const updateWidth = (nextWidth: number) => {
    const next = clamp(nextWidth, PREVIEW_DOCK_MIN_WIDTH, maximumWidth);
    currentWidthRef.current = next;
    onWidthChange(next);
    showHud();
    return next;
  };
  const commitWidth = (nextWidth: number) => {
    const next = updateWidth(nextWidth);
    onWidthCommit(next);
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: renderedWidth };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
    showHud();
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    updateWidth(drag.startWidth + drag.startX - event.clientX);
  };
  const finishPointerResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
    onWidthCommit(currentWidthRef.current);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") nextWidth = currentWidthRef.current + KEYBOARD_RESIZE_STEP;
    if (event.key === "ArrowRight") nextWidth = currentWidthRef.current - KEYBOARD_RESIZE_STEP;
    if (event.key === "Home") nextWidth = PREVIEW_DOCK_MIN_WIDTH;
    if (event.key === "End") nextWidth = maximumWidth;
    if (nextWidth === null) return;
    event.preventDefault();
    commitWidth(nextWidth);
  };
  const style = {
    "--workspace-preview-width": `${renderedWidth}px`,
  } as CSSProperties;

  return (
    <div ref={rootRef} className={`workspace-preview-split ${open ? "open" : "closed"}`} style={style}>
      <div className="workspace-preview-work">{children}</div>
      {open && (
        <>
          <button
            type="button"
            className={`workspace-preview-divider ${dragging ? "dragging" : ""}`}
            role="separator"
            aria-label="Resize Preview"
            aria-description="Drag or use arrow keys. Double-click resets to 500 pixels."
            aria-orientation="vertical"
            aria-valuemin={PREVIEW_DOCK_MIN_WIDTH}
            aria-valuemax={maximumWidth}
            aria-valuenow={renderedWidth}
            title="Drag to resize · Double-click resets"
            onDoubleClick={() => commitWidth(PREVIEW_DOCK_DEFAULT_WIDTH)}
            onKeyDown={handleKeyDown}
            onPointerCancel={finishPointerResize}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPointerResize}
          >
            <span className="workspace-preview-divider-handle" />
            <span className={`workspace-preview-width-hud ${hudVisible || dragging ? "visible" : ""}`}>
              {renderedWidth} px
            </span>
          </button>
          <div className="workspace-preview-dock">
            <WorkspacePreviewPanel {...previewProps} />
          </div>
        </>
      )}
    </div>
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
