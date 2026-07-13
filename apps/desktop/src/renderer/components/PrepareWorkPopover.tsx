import { useEffect, useRef, type ReactNode, type RefObject } from "react";

type PrepareWorkPopoverProps = {
  children: ReactNode;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

export function PrepareWorkPopover({ children, onClose, triggerRef }: PrepareWorkPopoverProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
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
  }, [onClose, triggerRef]);

  return (
    <div ref={dialogRef} className="prepare-work-popover" role="dialog" aria-label="Prepare Work">
      {children}
    </div>
  );
}
