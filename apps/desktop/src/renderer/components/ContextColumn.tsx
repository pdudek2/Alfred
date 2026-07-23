import { X } from "lucide-react";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { AgentTimelinePanel, type AgentTimelinePanelProps } from "./AgentTimelinePanel";

export type ContextColumnProps = {
  contextOpen: boolean;
  dismissalSuspended?: boolean;
  focusRequestKey: number;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  timelineProps: AgentTimelinePanelProps;
  onCloseContext: () => void;
};

export function ContextColumn({
  contextOpen,
  dismissalSuspended = false,
  focusRequestKey,
  returnFocusRef,
  timelineProps,
  onCloseContext,
}: ContextColumnProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const handledFocusRequestKeyRef = useRef(0);
  const restoreFocusOnCloseRef = useRef(false);
  const wasOpenRef = useRef(contextOpen);

  const requestCloseContext = useCallback(() => {
    restoreFocusOnCloseRef.current = true;
    onCloseContext();
  }, [onCloseContext]);

  useEffect(() => {
    if (!contextOpen || dismissalSuspended) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      requestCloseContext();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [contextOpen, dismissalSuspended, requestCloseContext]);

  useEffect(() => {
    if (!contextOpen || focusRequestKey === handledFocusRequestKeyRef.current) return;
    handledFocusRequestKeyRef.current = focusRequestKey;
    if (dismissalSuspended) return;
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [contextOpen, dismissalSuspended, focusRequestKey]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = contextOpen;
    if (!wasOpen || contextOpen || !restoreFocusOnCloseRef.current) return;
    restoreFocusOnCloseRef.current = false;
    const frame = requestAnimationFrame(() => returnFocusRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [contextOpen, returnFocusRef]);

  return (
    <aside
      aria-label="Session context"
      className={`context-column ${contextOpen ? "open" : "closed"}`}
      data-testid="context-column"
    >
      <div
        className={`side-dock-stack context-drawer ${contextOpen ? "open" : "closed"}`}
        data-testid="context-drawer"
        aria-hidden={contextOpen ? "false" : "true"}
        inert={!contextOpen || undefined}
      >
        <header className="context-drawer-header">
          <div>
            <span>Context</span>
          </div>
          <button ref={closeButtonRef} type="button" onClick={requestCloseContext} aria-label="Close Context panel">
            <X size={15} />
          </button>
        </header>
        <AgentTimelinePanel {...timelineProps} />
      </div>
    </aside>
  );
}
