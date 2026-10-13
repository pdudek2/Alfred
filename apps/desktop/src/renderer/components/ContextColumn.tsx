import { useCallback, useEffect, useRef, type RefObject } from "react";
import { AgentTimelinePanel, type AgentTimelinePanelProps } from "./AgentTimelinePanel";
import { SideColumnTabs } from "./SideColumnTabs";

export type ContextColumnProps = {
  contextOpen: boolean;
  dismissalSuspended?: boolean;
  focusRequestKey: number;
  returnFocusRef: RefObject<HTMLElement | null>;
  /** The stack's own Details tab: where focus lands when the element that opened Details is gone. */
  triggerRef: RefObject<HTMLElement | null>;
  shortcutModifier: "Cmd" | "Ctrl";
  timelineProps: AgentTimelinePanelProps;
  onCloseContext: () => void;
};

export function ContextColumn({
  contextOpen,
  dismissalSuspended = false,
  focusRequestKey,
  returnFocusRef,
  triggerRef,
  shortcutModifier,
  timelineProps,
  onCloseContext,
}: ContextColumnProps) {
  const detailsTabRef = useRef<HTMLButtonElement | null>(null);
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
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="menu"]')) return;
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
    const frame = requestAnimationFrame(() => detailsTabRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [contextOpen, dismissalSuspended, focusRequestKey]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = contextOpen;
    if (!wasOpen || contextOpen || !restoreFocusOnCloseRef.current) return;
    restoreFocusOnCloseRef.current = false;
    const frame = requestAnimationFrame(() => {
      const target = returnFocusRef.current;
      (target?.isConnected ? target : triggerRef.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [contextOpen, returnFocusRef, triggerRef]);

  return (
    <aside
      aria-label="Details"
      className={`context-column ${contextOpen ? "open" : "closed"}`}
      data-testid="context-column"
    >
      <div
        className={`context-drawer ${contextOpen ? "open" : "closed"}`}
        data-testid="context-drawer"
        aria-hidden={contextOpen ? "false" : "true"}
        inert={!contextOpen || undefined}
      >
        <SideColumnTabs
          detailsOpen
          detailsTabRef={detailsTabRef}
          shortcutModifier={shortcutModifier}
          onToggleDetails={requestCloseContext}
        />
        <AgentTimelinePanel {...timelineProps} />
      </div>
    </aside>
  );
}
