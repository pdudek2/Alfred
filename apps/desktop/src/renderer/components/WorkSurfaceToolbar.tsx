import { Plus } from "lucide-react";
import { shortenPath } from "../path-display";
import type { WorkMode } from "../terminal-desk-types";

export type WorkSurfaceToolbarProps = {
  arrangeMode: boolean;
  branch: string | undefined;
  rootPath: string | undefined;
  visibleSessionCount: number;
  workMode: WorkMode;
  onAddManualSession: () => void;
  onApplyWorkMode: (mode: WorkMode) => void;
  onToggleArrangeMode: () => void;
};

export function WorkSurfaceToolbar({
  arrangeMode,
  branch,
  rootPath,
  visibleSessionCount,
  workMode,
  onAddManualSession,
  onApplyWorkMode,
  onToggleArrangeMode,
}: WorkSurfaceToolbarProps) {
  const location = rootPath ? shortenPath(rootPath) : "local desk";
  const branchDetail = branch ? ` · ${branch}` : "";
  const sessionLabel = visibleSessionCount === 1 ? "visible session" : "visible sessions";

  return (
    <div className="work-surface-toolbar" role="toolbar" aria-label="Work layout controls">
      <button type="button" aria-label="New terminal" title="New terminal" onClick={onAddManualSession}>
        <Plus aria-hidden="true" size={14} />
      </button>
      <div className="work-surface-layout" role="group" aria-label="Layout mode">
        <button type="button" aria-pressed={workMode === "focus"} onClick={() => onApplyWorkMode("focus")}>
          Focus
        </button>
        <button type="button" aria-pressed={workMode === "split"} onClick={() => onApplyWorkMode("split")}>
          Split
        </button>
        <button type="button" aria-pressed={workMode === "desk"} onClick={() => onApplyWorkMode("desk")}>
          Grid
        </button>
        <button type="button" aria-pressed={arrangeMode} onClick={onToggleArrangeMode}>
          Arrange
        </button>
      </div>
      <span className="work-surface-context">
        {location}{branchDetail} · {visibleSessionCount} {sessionLabel}
      </span>
    </div>
  );
}
