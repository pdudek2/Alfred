import { Eye, ListChecks, Plus, Search } from "lucide-react";
import type { ReactNode } from "react";

type WorkMode = "focus" | "split" | "desk";
type ActiveSurface = "work" | "inbox" | "history";

type WorkbenchHeaderProps = {
  activeSurface: ActiveSurface;
  activeSessionCount: number;
  arrangeMode: boolean;
  contextOpen: boolean;
  contextSignalCount: number;
  inboxCount: number;
  sessionCount: number;
  shortcutModifier: "Cmd" | "Ctrl";
  workMode: WorkMode;
  workspaceSwitcher: ReactNode;
  onAddAgentSession: (kind: "codex" | "claude") => void;
  onAddManualSession: () => void;
  onApplyWorkMode: (mode: WorkMode) => void;
  onOpenInbox: () => void;
  onOpenSessionObservatory: () => void;
  onToggleArrangeMode: () => void;
  onToggleContext: () => void;
};

export function WorkbenchHeader({
  activeSurface,
  activeSessionCount,
  arrangeMode,
  contextOpen,
  contextSignalCount,
  inboxCount,
  sessionCount,
  shortcutModifier,
  workMode,
  workspaceSwitcher,
  onAddAgentSession,
  onAddManualSession,
  onApplyWorkMode,
  onOpenInbox,
  onOpenSessionObservatory,
  onToggleArrangeMode,
  onToggleContext,
}: WorkbenchHeaderProps) {
  const sessionCountLabel = `${activeSessionCount} session${activeSessionCount === 1 ? "" : "s"}`;
  const contextSignalLabel =
    contextSignalCount > 0 ? `, ${contextSignalCount} important signal${contextSignalCount === 1 ? "" : "s"}` : "";
  const contextLabel = `${contextOpen ? "Close" : "Open"} Context drawer${contextSignalLabel}`;
  const sessionsLabel = `Open session quick switch, ${sessionCount} session${sessionCount === 1 ? "" : "s"}`;
  const inboxLabel = `Open Inbox surface${inboxCount > 0 ? `, ${inboxCount} item${inboxCount === 1 ? "" : "s"}` : ""}`;
  const newTerminalShortcut = shortcutModifier === "Cmd" ? "Meta+T" : "Control+T";

  return (
    <header className="workbench-header" data-testid="workbench-header">
      {workspaceSwitcher}
      {activeSurface === "work" && (
        <div className="workbench-bar-title">
          <h1>Terminal grid</h1>
          <span>{sessionCountLabel}</span>
        </div>
      )}
      <div className="workbench-bar-spacer" aria-hidden="true" />
      <div className="workbench-actions" role="group" aria-label="terminal actions">
        {activeSurface === "work" && (
          <div className="workbench-tool-group workbench-layout-group" role="group" aria-label="Layout mode">
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
        )}
        <div className="workbench-tool-group workbench-panel-group" role="group" aria-label="Panels">
          <button
            type="button"
            className={contextOpen ? "active" : ""}
            aria-label={contextLabel}
            title="Context"
            aria-expanded={contextOpen}
            onClick={onToggleContext}
          >
            <Eye size={15} />
            {contextSignalCount > 0 && <span className="quiet-count-dot" aria-hidden="true" />}
          </button>
          <button type="button" aria-label={sessionsLabel} title="Sessions" onClick={onOpenSessionObservatory}>
            <Search size={15} />
            {sessionCount > 0 && <span className="quiet-count-mark" aria-hidden="true" />}
          </button>
          <button type="button" aria-label={inboxLabel} title="Inbox" onClick={onOpenInbox}>
            <ListChecks size={15} />
            {inboxCount > 0 && <span className="quiet-count-dot attention" aria-hidden="true" />}
          </button>
        </div>
        <div className="workbench-tool-group workbench-launch-group" role="group" aria-label="Launch">
          <button type="button" aria-label="Start Codex" onClick={() => onAddAgentSession("codex")}>
            Codex
          </button>
          <button type="button" aria-label="Start Claude" onClick={() => onAddAgentSession("claude")}>
            Claude
          </button>
          <button
            type="button"
            className="workbench-primary-action"
            aria-label="New terminal"
            aria-keyshortcuts={newTerminalShortcut}
            title={`New terminal (${shortcutModifier}+T)`}
            onClick={onAddManualSession}
          >
            <Plus size={16} />
            <span>New terminal</span>
          </button>
        </div>
      </div>
    </header>
  );
}
