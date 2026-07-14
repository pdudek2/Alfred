import { X } from "lucide-react";
import { useEffect, useRef, type RefObject } from "react";
import { AgentTimelinePanel, type AgentTimelinePanelProps } from "./AgentTimelinePanel";
import { WorkspacePreviewPanel, type WorkspacePreviewPanelProps } from "./WorkspacePreviewPanel";

export type ContextColumnProps = {
  contextOpen: boolean;
  previewVisible: boolean;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  timelineProps: AgentTimelinePanelProps;
  previewProps: WorkspacePreviewPanelProps;
  onCloseContext: () => void;
};

export function ContextColumn({
  contextOpen,
  previewVisible,
  returnFocusRef,
  timelineProps,
  previewProps,
  onCloseContext,
}: ContextColumnProps) {
  const wasOpenRef = useRef(contextOpen);

  useEffect(() => {
    if (!contextOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onCloseContext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contextOpen, onCloseContext]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = contextOpen;
    if (!wasOpen || contextOpen) return;
    const frame = requestAnimationFrame(() => returnFocusRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [contextOpen, returnFocusRef]);

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
          <button type="button" onClick={onCloseContext} aria-label="Close Context panel">
            <X size={15} />
          </button>
        </header>
        {previewVisible && <WorkspacePreviewPanel {...previewProps} />}
        <AgentTimelinePanel {...timelineProps} />
      </div>
    </aside>
  );
}
