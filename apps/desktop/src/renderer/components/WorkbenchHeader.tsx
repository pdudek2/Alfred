import { Command, Layers3, ListChecks, Plus } from "lucide-react";
import type { ReactNode, Ref } from "react";
import type { SessionTile } from "../session-state";
import type { WorkMode } from "../terminal-desk-types";
import { ChromeMenu, type ChromeMenuItem } from "./ChromeMenu";
import { SessionChromeRow, workChromeSessions } from "./SessionChromeRow";

export type PrimarySurface = "work" | "inbox" | "history";

export type WorkbenchHeaderProps = {
  activeSessions: SessionTile[];
  activeSurface: PrimarySurface;
  arrangeMode: boolean;
  commandPaletteTriggerRef?: Ref<HTMLButtonElement>;
  inboxCount: number;
  prepareWorkTriggerRef?: Ref<HTMLButtonElement>;
  selectedSessionId: string | null;
  shortcutModifier: "Cmd" | "Ctrl";
  workMode: WorkMode;
  workspaceDetail: string;
  workspaceSwitcher: ReactNode;
  onAddAgentSession: (kind: "codex" | "claude") => void;
  onAddManualSession: () => void;
  onApplyWorkMode: (mode: WorkMode) => void;
  onCloseSession: (sessionId: string) => void;
  onFocusSession: (sessionId: string) => void;
  onOpenCommandPalette: () => void;
  onOpenInbox: () => void;
  onOpenPrepareWork: () => void;
  onOpenPrivacyControls: () => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onSelectSurface: (surface: PrimarySurface) => void;
  onToggleArrangeMode: () => void;
  onToggleContext: () => void;
};

export function WorkbenchHeader({
  activeSessions,
  activeSurface,
  arrangeMode,
  commandPaletteTriggerRef,
  inboxCount,
  prepareWorkTriggerRef,
  selectedSessionId,
  shortcutModifier,
  workMode,
  workspaceDetail,
  workspaceSwitcher,
  onAddAgentSession,
  onAddManualSession,
  onApplyWorkMode,
  onCloseSession,
  onFocusSession,
  onOpenCommandPalette,
  onOpenInbox,
  onOpenPrepareWork,
  onOpenPrivacyControls,
  onRenameSession,
  onSelectSurface,
  onToggleArrangeMode,
  onToggleContext,
}: WorkbenchHeaderProps) {
  const chromeSessions = workChromeSessions(activeSessions);
  const selectedSession = selectedSessionId
    ? activeSessions.find((session) => session.id === selectedSessionId) ?? null
    : null;
  const selectedSessionHasChromeTab = selectedSession
    ? chromeSessions.some((session) => session.id === selectedSession.id)
    : false;
  const workIdentitySession = activeSurface === "work"
    ? selectedSession ?? (chromeSessions.length === 1 ? chromeSessions[0] ?? null : null)
    : null;
  const expanded = activeSurface === "work" && (
    chromeSessions.length > 1 ||
    arrangeMode ||
    Boolean(selectedSession && !selectedSessionHasChromeTab)
  );
  const inboxLabel = `Open Inbox surface${inboxCount > 0 ? `, ${inboxCount} item${inboxCount === 1 ? "" : "s"}` : ""}`;
  const launchItems: ChromeMenuItem[] = [
    { id: "prepare-work", label: "Prepare Work", run: onOpenPrepareWork },
    { id: "new-codex", label: "New Codex session", run: () => onAddAgentSession("codex") },
    { id: "new-claude", label: "New Claude session", run: () => onAddAgentSession("claude") },
    { id: "new-manual", label: "New manual terminal", run: onAddManualSession },
  ];
  const surfaceItems: ChromeMenuItem[] = [
    { id: "work", label: "Work", run: () => onSelectSurface("work") },
    { id: "observatory", label: "Observatory", run: () => onSelectSurface("history") },
    { id: "context", label: "Context", run: onToggleContext },
    { id: "privacy", label: "Local Data & Privacy", run: onOpenPrivacyControls },
  ];

  return (
    <header
      className={expanded ? "workbench-header is-expanded" : "workbench-header is-compact"}
      data-testid="workbench-header"
      data-chrome-height={expanded ? "74" : "40"}
    >
      <div className="workbench-primary-row">
        <div className="workbench-project-zone">{workspaceSwitcher}</div>
        <div className="workbench-session-context">
          {workIdentitySession && (
            <>
              <span>{workIdentitySession.title}</span>
              <small>{workspaceDetail}</small>
            </>
          )}
          <ChromeMenu
            {...(prepareWorkTriggerRef ? { triggerRef: prepareWorkTriggerRef } : {})}
            label="Open launch menu"
            title="New"
            items={launchItems}
          >
            <Plus aria-hidden="true" size={14} />
          </ChromeMenu>
        </div>
        <div className="workbench-right-zone">
          <button type="button" aria-label={inboxLabel} title="Inbox" onClick={onOpenInbox}>
            <ListChecks aria-hidden="true" size={14} />
            {inboxCount > 0 && <span className="workbench-attention-count">{inboxCount}</span>}
          </button>
          <ChromeMenu label="Open Surfaces menu" title="Surfaces" items={surfaceItems}>
            <Layers3 aria-hidden="true" size={14} />
          </ChromeMenu>
          <button
            ref={commandPaletteTriggerRef}
            type="button"
            aria-label="Open command palette"
            title={shortcutModifier + " K"}
            onClick={onOpenCommandPalette}
          >
            <Command aria-hidden="true" size={14} />
            <kbd>{shortcutModifier === "Cmd" ? "⌘K" : "Ctrl K"}</kbd>
          </button>
        </div>
      </div>
      {expanded && (
        <SessionChromeRow
          activeSessionId={selectedSessionId}
          arrangeMode={arrangeMode}
          sessions={activeSessions}
          workMode={workMode}
          workspaceDetail={workspaceDetail}
          onAddManualSession={onAddManualSession}
          onApplyWorkMode={onApplyWorkMode}
          onCloseSession={onCloseSession}
          onFocusSession={onFocusSession}
          onRenameSession={onRenameSession}
          onToggleArrangeMode={onToggleArrangeMode}
        />
      )}
    </header>
  );
}
