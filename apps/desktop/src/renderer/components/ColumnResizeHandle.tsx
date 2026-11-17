import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import "./column-resize-handle.css";

const KEY_STEP = 16;

export type ColumnResizeHandleProps = {
  label: string;
  /** The column edge the handle sits on: dragging it outward widens the column. */
  edge: "left" | "right";
  /** The custom property on `.desktop-frame` that sizes the column. */
  cssVariable: string;
  width: number;
  min: number;
  max: number;
  /** The width a double click goes back to. */
  initial: number;
  /** The widest the column can be in the window as it is now, below `max`. */
  room?: (handle: HTMLElement) => number;
  onChange: (width: number) => void;
};

export function ColumnResizeHandle({ label, edge, cssVariable, width, min, max, initial, room, onChange }: ColumnResizeHandleProps) {
  const drag = useRef<{ startX: number; start: number; width: number; max: number } | null>(null);
  const outward = edge === "right" ? 1 : -1;
  const widest = (handle: HTMLElement) => Math.max(min, Math.min(max, Math.floor(room?.(handle) ?? max)));
  const clamp = (next: number, upTo: number) => Math.min(upTo, Math.max(min, Math.round(next)));
  const frame = (element: Element) => element.closest<HTMLElement>(".desktop-frame");

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    // A page frame under the pointer would take the moves for itself.
    frame(event.currentTarget)?.classList.add("column-resizing");
    // A column the window already narrowed starts from the width it shows.
    const upTo = widest(event.currentTarget);
    drag.current = { startX: event.clientX, start: Math.min(width, upTo), width: Math.min(width, upTo), max: upTo };
  };
  // The column moves directly during a drag: rendering the whole app on every pointer move would stall the terminals.
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.width = clamp(drag.current.start + (event.clientX - drag.current.startX) * outward, drag.current.max);
    frame(event.currentTarget)?.style.setProperty(cssVariable, `${drag.current.width}px`);
  };
  const handleDragEnd = (event: PointerEvent<HTMLDivElement>) => {
    frame(event.currentTarget)?.classList.remove("column-resizing");
    const dragged = drag.current?.width;
    drag.current = null;
    if (dragged !== undefined && dragged !== width) onChange(dragged);
    else frame(event.currentTarget)?.style.setProperty(cssVariable, `${width}px`);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const upTo = widest(event.currentTarget);
    const shown = Math.min(width, upTo);
    const next = {
      ArrowLeft: shown - KEY_STEP * outward,
      ArrowRight: shown + KEY_STEP * outward,
      Home: min,
      End: upTo,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange(clamp(next, upTo));
  };

  return (
    <div
      className={`column-resize-handle edge-${edge}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      onDoubleClick={() => onChange(initial)}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={handleDragEnd}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
    />
  );
}
