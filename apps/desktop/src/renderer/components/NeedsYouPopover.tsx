import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import type { AttentionProjection } from "../attention-projection";
import { AlfredSignalGlyph } from "./AlfredSignalGlyph";
import "./needs-you-popover.css";

type NeedsYouPopoverProps = {
  dismissalSuspended?: boolean;
  items: AttentionProjection[];
  shortcutLabel: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onRunAction: (item: AttentionProjection) => void;
};

export function NeedsYouPopover({
  dismissalSuspended = false,
  items,
  shortcutLabel,
  triggerRef,
  onClose,
  onRunAction,
}: NeedsYouPopoverProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusedIndexRef = useRef(0);
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const first = rowButtons(dialogRef.current)[0];
      (first ?? dialogRef.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // A row leaves the list once its session stops waiting. Keep focus inside
  // the popover instead of letting it fall back to the document body.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.contains(document.activeElement)) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    const buttons = rowButtons(dialog);
    const next = buttons[Math.min(focusedIndexRef.current, buttons.length - 1)];
    (next ?? dialog).focus();
  }, [items]);

  // Escape and the shortcut return focus to where the user was. Picking a row
  // or clicking elsewhere hands focus to that target instead.
  const restoreFocusOnCloseRef = useRef(true);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const previous = previouslyFocusedRef.current;
    const trigger = triggerRef.current;
    return () => {
      if (!restoreFocusOnCloseRef.current || !dialog?.contains(document.activeElement)) return;
      queueMicrotask(() => {
        const target = previous?.isConnected && previous !== document.body ? previous : trigger;
        if (target?.isConnected) target.focus();
      });
    };
  }, [triggerRef]);

  useEffect(() => {
    if (dismissalSuspended) return;

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (dialogRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      restoreFocusOnCloseRef.current = false;
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [dismissalSuspended, onClose, triggerRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = rowButtons(dialogRef.current);
    if (buttons.length === 0) return;
    const current = buttons.findIndex((button) => button === document.activeElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : Math.min(current + 1, buttons.length - 1);
    if (event.key === "ArrowUp") next = current < 0 ? 0 : Math.max(current - 1, 0);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = buttons.length - 1;
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <div
      ref={dialogRef}
      className="needs-you-popover"
      role="dialog"
      aria-label="Needs you"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onFocusCapture={(event) => {
        const index = rowButtons(dialogRef.current).findIndex((button) => button === (event.target as EventTarget));
        if (index >= 0) focusedIndexRef.current = index;
      }}
    >
      <header className="needs-you-popover__header">
        <h2>Needs you</h2>
        <kbd>{shortcutLabel}</kbd>
      </header>
      {items.length === 0 ? (
        <p className="needs-you-popover__empty" role="status">Nothing needs you right now.</p>
      ) : (
        <ul className="needs-you-popover__list" aria-label="Blocked on you">
          {items.map((item) => (
            <li className="needs-you-popover__row" key={item.id}>
              <AlfredSignalGlyph className="needs-you-popover__glyph" />
              <div className="needs-you-popover__copy">
                <div className="needs-you-popover__title">
                  <strong>{item.sessionTitle}</strong>
                  <span>{item.workspaceLabel}</span>
                </div>
                <p title={item.reason}>{item.reason}</p>
              </div>
              <button
                type="button"
                data-needs-you-row
                aria-label={`${needsYouActionLabel(item)} ${item.sessionTitle} in ${item.workspaceLabel}`}
                onClick={() => {
                  restoreFocusOnCloseRef.current = false;
                  onRunAction(item);
                }}
              >
                {needsYouActionLabel(item)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function needsYouActionLabel(item: AttentionProjection): "Open" | "Edit" {
  return item.action.kind === "review-edit" ? "Edit" : "Open";
}

function rowButtons(root: HTMLElement | null): HTMLButtonElement[] {
  return root ? [...root.querySelectorAll<HTMLButtonElement>("[data-needs-you-row]")] : [];
}
