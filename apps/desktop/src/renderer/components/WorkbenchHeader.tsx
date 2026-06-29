import { Eye, ListChecks, Plus, Search } from "lucide-react";

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
  workMode: WorkMode;
  workspaceLabel: string;
  workspacePathLabel: string;
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
  workMode,
  workspaceLabel,
  workspacePathLabel,
  onAddAgentSession,
  onAddManualSession,
  onApplyWorkMode,
  onOpenInbox,
  onOpenSessionObservatory,
  onToggleArrangeMode,
  onToggleContext,
}: WorkbenchHeaderProps) {
  const surfaceLabel = activeSurface === "work" ? "Terminal grid" : activeSurface === "inbox" ? "Inbox" : "History";
  const surfaceCrumb = activeSurface === "work" ? "Work" : activeSurface === "inbox" ? "Inbox" : "History";
  const headline =
    activeSurface === "work"
      ? "Alfred orchestrates multiple live terminals"
      : activeSurface === "inbox"
        ? "Inbox collects decisions and recovery"
        : "History keeps sessions and external Codex";
  const liveLabel = `${activeSessionCount} live`;
  const contextLabel = contextOpen
    ? "Close Context drawer"
    : `Open Context drawer${contextSignalCount > 0 ? `, ${contextSignalCount} important signal${contextSignalCount === 1 ? "" : "s"}` : ""}`;
  const sessionsLabel = `Open session observatory, ${sessionCount} session${sessionCount === 1 ? "" : "s"}`;
  const inboxLabel = `Open Inbox surface${inboxCount > 0 ? `, ${inboxCount} item${inboxCount === 1 ? "" : "s"}` : ""}`;

  return (
    <header className="workbench-header" data-testid="workbench-header">
      <div className="workbench-title-block">
        <div className="workbench-crumbs">
          <span>{surfaceCrumb}</span>
          <span>/</span>
          <span>{workspaceLabel}</span>
          <span>/</span>
          <span>{surfaceLabel}</span>
        </div>
        <div className="workbench-title-line">
          <h1>{headline}</h1>
          <span>{liveLabel}</span>
        </div>
        <p>{workspacePathLabel}</p>
      </div>
      <div className="workbench-actions" role="group" aria-label="terminal actions">
        {activeSurface === "work" && (
          <div className="workbench-tool-group" aria-label="Layout mode">
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
        <button
          type="button"
          className={contextOpen ? "active" : ""}
          aria-label={contextLabel}
          aria-expanded={contextOpen}
          onClick={onToggleContext}
        >
          <Eye size={15} />
          <span>Context</span>
          {contextSignalCount > 0 && <strong>{contextSignalCount}</strong>}
        </button>
        <button type="button" aria-label={sessionsLabel} onClick={onOpenSessionObservatory}>
          <Search size={15} />
          <span>Sessions</span>
          {sessionCount > 0 && <strong>{sessionCount}</strong>}
        </button>
        <button type="button" aria-label={inboxLabel} onClick={onOpenInbox}>
          <ListChecks size={15} />
          <span>Inbox</span>
          {inboxCount > 0 && <strong>{inboxCount}</strong>}
        </button>
        <button type="button" aria-label="Start Codex" onClick={() => onAddAgentSession("codex")}>
          Codex
        </button>
        <button type="button" aria-label="Start Claude" onClick={() => onAddAgentSession("claude")}>
          Claude
        </button>
        <button type="button" className="workbench-primary-action" aria-label="New terminal" onClick={onAddManualSession}>
          <Plus size={16} />
          <span>New terminal</span>
        </button>
      </div>
    </header>
  );
}
