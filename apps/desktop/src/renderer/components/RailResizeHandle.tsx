import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { clampRailWidth, DEFAULT_RAIL_WIDTH, MAX_RAIL_WIDTH } from "../../shared/layout-ipc";
import "./rail-resize-handle.css";

const KEY_STEP = 16;

export function RailResizeHandle({ width, onChange }: { width: number; onChange: (width: number) => void }) {
  const drag = useRef<{ startX: number; width: number } | null>(null);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, width };
  };
  // The column moves directly during a drag: rendering the whole app on every pointer move would stall the terminals.
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.width = clampRailWidth(width + event.clientX - drag.current.startX);
    event.currentTarget.closest<HTMLElement>(".desktop-frame")?.style.setProperty("--rail-width", `${drag.current.width}px`);
  };
  const handleDragEnd = () => {
    const dragged = drag.current?.width;
    drag.current = null;
    if (dragged !== undefined && dragged !== width) onChange(dragged);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = { ArrowLeft: width - KEY_STEP, ArrowRight: width + KEY_STEP, Home: DEFAULT_RAIL_WIDTH, End: MAX_RAIL_WIDTH }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange(clampRailWidth(next));
  };

  return (
    <div
      className="rail-resize-handle"
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemin={DEFAULT_RAIL_WIDTH}
      aria-valuemax={MAX_RAIL_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onDoubleClick={() => onChange(DEFAULT_RAIL_WIDTH)}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={handleDragEnd}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
    />
  );
}
