import { PanelRight, Plus } from "lucide-react";
import type { Ref } from "react";
import "./work-surface-toolbar.css";

export type WorkSurfaceToolbarProps = {
  previewAvailable: boolean;
  previewOpen: boolean;
  previewTriggerRef?: Ref<HTMLButtonElement>;
  terminalLaunchDisabled?: boolean;
  onAddManualSession: () => void;
  onTogglePreview: () => void;
};

export function WorkSurfaceToolbar({
  previewAvailable,
  previewOpen,
  previewTriggerRef,
  terminalLaunchDisabled = false,
  onAddManualSession,
  onTogglePreview,
}: WorkSurfaceToolbarProps) {
  return (
    <div className="work-surface-toolbar" role="toolbar" aria-label="Work layout controls">
      <button
        type="button"
        aria-label="New terminal"
        disabled={terminalLaunchDisabled}
        title={terminalLaunchDisabled ? "Choose the project folder first" : "New terminal"}
        onClick={onAddManualSession}
      >
        <Plus aria-hidden="true" size={14} />
      </button>
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
    </div>
  );
}
