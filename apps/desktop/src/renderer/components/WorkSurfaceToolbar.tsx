import { Archive, ChevronDown, PanelRight, Plus } from "lucide-react";
import type { Ref } from "react";
import { shortenPath } from "../path-display";
import type { WorkMode } from "../terminal-desk-types";
import { ChromeMenu, type ChromeMenuItem } from "./ChromeMenu";
import { AlfredSignalGlyph } from "./AlfredSignalGlyph";
import "./work-surface-toolbar.css";

export type WorkSurfaceToolbarProps = {
  activeAgentCount: number;
  agentsOpen: boolean;
  agentsTriggerRef?: Ref<HTMLButtonElement>;
  arrangeMode: boolean;
  branch: string | undefined;
  previewAvailable: boolean;
  previewOpen: boolean;
  previewTriggerRef?: Ref<HTMLButtonElement>;
  rootPath: string | undefined;
  savedSessionCount: number;
  terminalLaunchDisabled?: boolean;
  visibleSessionCount: number;
  workMode: WorkMode;
  onAddManualSession: () => void;
  onApplyWorkMode: (mode: WorkMode) => void;
  onOpenSavedSessions: () => void;
  onToggleArrangeMode: () => void;
  onToggleAgents: () => void;
  onTogglePreview: () => void;
};

export function WorkSurfaceToolbar({
  activeAgentCount,
  agentsOpen,
  agentsTriggerRef,
  arrangeMode,
  branch,
  previewAvailable,
  previewOpen,
  previewTriggerRef,
  rootPath,
  savedSessionCount,
  terminalLaunchDisabled = false,
  visibleSessionCount,
  workMode,
  onAddManualSession,
  onApplyWorkMode,
  onOpenSavedSessions,
  onToggleArrangeMode,
  onToggleAgents,
  onTogglePreview,
}: WorkSurfaceToolbarProps) {
  const location = rootPath ? shortenPath(rootPath) : "local desk";
  const branchDetail = branch ? ` · ${branch}` : "";
  const displayedSessionCount = !arrangeMode && workMode === "desk"
    ? Math.min(3, visibleSessionCount)
    : visibleSessionCount;
  const sessionLabel = displayedSessionCount === 1 ? "visible session" : "visible sessions";
  const selectedLayoutLabel = arrangeMode ? "Arrange" : workModeLabel(workMode);
  const selectedLayoutId = arrangeMode ? "arrange" : workMode === "desk" ? "grid" : workMode;
  const applyWorkMode = (mode: WorkMode) => {
    if (arrangeMode) onToggleArrangeMode();
    onApplyWorkMode(mode);
  };
  const layoutItems: ChromeMenuItem[] = [
    { id: "focus", label: "Focus", run: () => applyWorkMode("focus") },
    { id: "split", label: "Split", run: () => applyWorkMode("split") },
    { id: "grid", label: "Grid", run: () => applyWorkMode("desk") },
    { id: "arrange", label: "Arrange", run: onToggleArrangeMode },
  ];

  return (
    <div className="work-surface-toolbar" role="toolbar" aria-label="Work layout controls">
      <button
        type="button"
        aria-label="New terminal"
        disabled={terminalLaunchDisabled}
        title={terminalLaunchDisabled ? "Choose the workspace folder first" : "New terminal"}
        onClick={onAddManualSession}
      >
        <Plus aria-hidden="true" size={14} />
      </button>
      <div className="work-surface-layout">
        <ChromeMenu
          label={`Open layout menu, ${selectedLayoutLabel} selected`}
          selectedItemId={selectedLayoutId}
          title="Layout"
          items={layoutItems}
        >
          <span>Layout</span>
          <strong>{selectedLayoutLabel}</strong>
          <ChevronDown aria-hidden="true" size={12} />
        </ChromeMenu>
      </div>
      <button
        ref={previewTriggerRef}
        type="button"
        className="work-preview-toggle"
        aria-pressed={previewOpen}
        disabled={!previewAvailable}
        title={previewAvailable ? "Toggle Preview" : "Start a local dev server to enable Preview"}
        onClick={onTogglePreview}
      >
        <PanelRight aria-hidden="true" size={13} />
        <span>Preview</span>
      </button>
      <button
        ref={agentsTriggerRef}
        type="button"
        className="work-agents-toggle"
        aria-label={`Agents, ${activeAgentCount} active`}
        aria-pressed={agentsOpen}
        onClick={onToggleAgents}
      >
        <AlfredSignalGlyph />
        <span>Agents</span>
        <strong>{activeAgentCount} active</strong>
      </button>
      <span className="work-surface-context">
        {location}{branchDetail} · {displayedSessionCount} {sessionLabel}
      </span>
      {savedSessionCount > 0 && (
        <button
          type="button"
          className="work-saved-sessions"
          aria-label={`Browse ${savedSessionCount} saved session${savedSessionCount === 1 ? "" : "s"}`}
          title="Open saved sessions"
          onClick={onOpenSavedSessions}
        >
          <Archive aria-hidden="true" size={13} />
          <span>{savedSessionCount} saved</span>
        </button>
      )}
    </div>
  );
}

function workModeLabel(workMode: WorkMode): string {
  if (workMode === "focus") return "Focus";
  if (workMode === "split") return "Split";
  return "Grid";
}
