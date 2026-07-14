import { Command, Layers3, ListChecks, Plus } from "lucide-react";
import type { Ref } from "react";
import type { SessionTile } from "../session-state";
import { AlfredMark } from "./AlfredMark";
import { ChromeMenu, type ChromeMenuItem } from "./ChromeMenu";

export type PrimarySurface = "work" | "inbox" | "history";

export type WorkbenchHeaderProps = {
  activeSurface: PrimarySurface;
  commandPaletteTriggerRef?: Ref<HTMLButtonElement>;
  inboxCount: number;
  prepareWorkTriggerRef?: Ref<HTMLButtonElement>;
  selectedSession: SessionTile | null;
  shortcutModifier: "Cmd" | "Ctrl";
  surfacesTriggerRef?: Ref<HTMLButtonElement>;
  workspaceDetail: string;
  onAddAgentSession: (kind: "codex" | "claude") => void;
  onAddManualSession: () => void;
  onOpenCommandPalette: () => void;
  onOpenInbox: () => void;
  onOpenPrepareWork: () => void;
  onOpenPrivacyControls: () => void;
  onSelectSurface: (surface: PrimarySurface) => void;
  onToggleContext: () => void;
};

export function WorkbenchHeader({
  activeSurface,
  commandPaletteTriggerRef,
  inboxCount,
  prepareWorkTriggerRef,
  selectedSession,
  shortcutModifier,
  surfacesTriggerRef,
  workspaceDetail,
  onAddAgentSession,
  onAddManualSession,
  onOpenCommandPalette,
  onOpenInbox,
  onOpenPrepareWork,
  onOpenPrivacyControls,
  onSelectSurface,
  onToggleContext,
}: WorkbenchHeaderProps) {
  const surfaceTitle = activeSurface === "inbox"
    ? "Decision Inbox"
    : activeSurface === "history"
      ? "Observatory"
      : selectedSession?.title ?? "Work";
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
    <header className="workbench-header" data-testid="workbench-header" data-chrome-height="40">
      <div className="workbench-primary-row">
        <div className="workbench-product-signature"><AlfredMark /></div>
        <div className="workbench-session-context">
          <span>{surfaceTitle}</span>
          <small>{activeSurface === "work" ? workspaceDetail : "Alfred"}</small>
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
          <ChromeMenu
            {...(surfacesTriggerRef ? { triggerRef: surfacesTriggerRef } : {})}
            label="Open Surfaces menu"
            title="Surfaces"
            items={surfaceItems}
          >
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
    </header>
  );
}
