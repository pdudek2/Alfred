import { X } from "lucide-react";
import { AgentTimelinePanel, type AgentTimelinePanelProps } from "./AgentTimelinePanel";
import { AlfredControlRail, type AlfredControlRailProps } from "./AlfredControlRail";
import { WorkspacePreviewPanel, type WorkspacePreviewPanelProps } from "./WorkspacePreviewPanel";

type ContextColumnProps = {
  contextOpen: boolean;
  inspectedTitle: string;
  previewVisible: boolean;
  timelineProps: AgentTimelinePanelProps;
  railProps: AlfredControlRailProps;
  previewProps: WorkspacePreviewPanelProps;
  onCloseContext: () => void;
};

export function ContextColumn({
  contextOpen,
  inspectedTitle,
  previewVisible,
  timelineProps,
  railProps,
  previewProps,
  onCloseContext,
}: ContextColumnProps) {
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
            <strong>{inspectedTitle}</strong>
          </div>
          <button type="button" onClick={onCloseContext} aria-label="Close Context panel">
            <X size={15} />
          </button>
        </header>
        {previewVisible && <WorkspacePreviewPanel {...previewProps} />}
        <AgentTimelinePanel {...timelineProps} />
      </div>
      <div
        className={`context-compact-status ${contextOpen ? "hidden" : "visible"}`}
        aria-hidden={contextOpen ? "true" : "false"}
        inert={contextOpen || undefined}
      >
        <AlfredControlRail {...railProps} />
      </div>
    </aside>
  );
}
