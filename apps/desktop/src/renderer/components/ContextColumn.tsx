import { X } from "lucide-react";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { AgentTimelinePanel, type AgentTimelinePanelProps } from "./AgentTimelinePanel";
import { WorkspacePreviewPanel, type WorkspacePreviewPanelProps } from "./WorkspacePreviewPanel";

export type ContextColumnProps = {
  contextOpen: boolean;
  dismissalSuspended?: boolean;
  previewVisible: boolean;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  timelineProps: AgentTimelinePanelProps;
  previewProps: WorkspacePreviewPanelProps;
  onCloseContext: () => void;
};

export function ContextColumn({
  contextOpen,
  dismissalSuspended = false,
  previewVisible,
  returnFocusRef,
  timelineProps,
  previewProps,
  onCloseContext,
}: ContextColumnProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusOnCloseRef = useRef(false);
  const wasOpenRef = useRef(false);

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
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = contextOpen;
    if (!wasOpen && contextOpen) {
      if (dismissalSuspended) return;
      const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    if (!wasOpen || contextOpen || !restoreFocusOnCloseRef.current) return;
    restoreFocusOnCloseRef.current = false;
    const frame = requestAnimationFrame(() => returnFocusRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [contextOpen, dismissalSuspended, returnFocusRef]);

  return (
    <aside className={`context-column ${contextOpen ? "open" : "closed"}`} data-testid="context-column">
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
        {previewVisible && <WorkspacePreviewPanel {...previewProps} />}
        <AgentTimelinePanel {...timelineProps} />
      </div>
    </aside>
  );
}
