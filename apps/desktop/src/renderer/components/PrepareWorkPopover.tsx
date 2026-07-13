import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

type PrepareWorkPopoverProps = {
  children: ReactNode;
  dismissalSuspended?: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

export function PrepareWorkPopover({
  children,
  dismissalSuspended = false,
  onClose,
  triggerRef,
}: PrepareWorkPopoverProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const previouslySuspendedRef = useRef(dismissalSuspended);
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useLayoutEffect(() => {
    if (previouslySuspendedRef.current && !dismissalSuspended) {
      lastFocusedElementRef.current?.focus();
    }
    previouslySuspendedRef.current = dismissalSuspended;
  }, [dismissalSuspended]);

  useEffect(() => {
    if (dismissalSuspended) return;

    const closeAndRestoreFocus = () => {
      onClose();
      const focusTarget = triggerRef.current ?? previouslyFocusedRef.current;
      queueMicrotask(() => focusTarget?.focus());
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeAndRestoreFocus();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (dialogRef.current?.contains(event.target as Node)) return;
      closeAndRestoreFocus();
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [dismissalSuspended, onClose, triggerRef]);

  return (
    <div
      ref={dialogRef}
      className="prepare-work-popover"
      role="dialog"
      aria-label="Prepare Work"
      onFocusCapture={(event) => {
        lastFocusedElementRef.current = event.target as HTMLElement;
      }}
    >
      {children}
    </div>
  );
}
